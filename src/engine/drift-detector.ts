import * as fs from "fs/promises";
import * as path from "path";
import { ILLMService, DriftCheckParams } from "../core/llm-service";
import { IIntentStore } from "../core/store";
import { IAttributionSource } from "../core/attribution-source";
import { IntentNode, IntentLink } from "../models/intent";
import { DriftEvent, createDriftEvent, Range } from "../models/drift";
import { IntentLinker } from "./intent-linker";
import { ConversationLoader } from "../core/intent-mesh-core";

export interface DriftDetectionResult {
  events: DriftEvent[];
  intentsChecked: number;
}

export type LogFn = (message: string, ...args: any[]) => void;

export class DriftDetector {
  private linker: IntentLinker;
  private logFn: LogFn;

  constructor(
    private readonly store: IIntentStore,
    private readonly attributionSource: IAttributionSource,
    private readonly llmService: ILLMService,
    logFn?: LogFn,
    conversationLoader?: ConversationLoader
  ) {
    this.linker = new IntentLinker(store, attributionSource, conversationLoader);
    this.logFn = logFn ?? ((msg, ...args) => console.log(`[DriftDetector] ${msg}`, ...args));
  }

  // Simple logger for debugging
  private log(message: string, ...args: any[]): void {
    this.logFn(message, ...args);
  }

  /**
   * Detect drift in a single file
   * @param fileUri - The file to check
   * @param diff - Optional git diff for the file (more efficient than full file)
   */
  async detectInFile(fileUri: string, diff?: string): Promise<DriftDetectionResult> {
    const fileName = fileUri.split("/").pop() || fileUri;
    
    // Get intents that apply to this file
    const intents = await this.linker.getIntentsForFile(fileUri);
    
    if (intents.length === 0) {
      return { events: [], intentsChecked: 0 };
    }
    
    this.log(`📋 Checking ${fileName} against ${intents.length} intent(s)`);

    const filePath = fileUri.replace(/^file:\/\//, "");
    const language = this.getLanguage(filePath);

    // If we have a diff, use it (more efficient)
    if (diff && diff.trim()) {
      return this.detectInDiff(fileUri, diff, intents, language);
    }

    // Fall back to reading full file
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      this.log(`⚠️  Could not read ${fileName}`);
      return { events: [], intentsChecked: 0 };
    }

    // Get links for this file to know which ranges to check
    const links = await this.store.getLinksForFile(fileUri);
    
    // Group intents by the code ranges they apply to
    const rangesToCheck = this.groupByRanges(intents, links, content);

    const allEvents: DriftEvent[] = [];

    for (const { intents: rangeIntents, code, startLine } of rangesToCheck) {
      // Call LLM to detect drift
      const params: DriftCheckParams = {
        intents: rangeIntents,
        code,
        filePath,
        language,
      };

      try {
        const analysis = await this.llmService.detectDrift(params);
        
        if (analysis.violations.length > 0) {
          this.log(`🚨 Found ${analysis.violations.length} violation(s) in ${fileName}`);
        }

        // Convert violations to DriftEvents
        for (const violation of analysis.violations) {
          // Find the matching intent
          const intent = rangeIntents.find((i) => i.id === violation.intentId);
          
          // Calculate absolute line numbers
          const absoluteStartLine = startLine + violation.lineStart - 1;
          const absoluteEndLine = startLine + violation.lineEnd - 1;

          // Get attribution for this range
          const attribution = await this.attributionSource.getRangeAttribution(
            fileUri,
            absoluteStartLine,
            absoluteEndLine
          );

          const range: Range = {
            startLine: absoluteStartLine,
            startCharacter: 0,
            endLine: absoluteEndLine,
            endCharacter: 0,
          };

          const event = createDriftEvent({
            fileUri,
            range,
            severity: violation.severity,
            confidence: violation.confidence,
            intentIds: intent ? [intent.id] : [],
            summary: violation.summary,
            explanation: violation.explanation,
            suggestedFix: violation.suggestedFix,
            attribution: attribution[0],
          });

          allEvents.push(event);
        }
      } catch (error) {
        console.error("LLM drift detection failed:", error);
      }
    }

    return { events: allEvents, intentsChecked: intents.length };
  }

  /**
   * Group intents by the code ranges they apply to
   * Returns code snippets with their applicable intents
   */
  private groupByRanges(
    intents: IntentNode[],
    links: IntentLink[],
    fileContent: string
  ): Array<{ intents: IntentNode[]; code: string; startLine: number }> {
    const lines = fileContent.split("\n");

    // If no specific ranges, check the whole file
    const rangeLinks = links.filter((l) => l.startLine && l.endLine);
    
    if (rangeLinks.length === 0) {
      // Check the whole file against all intents
      return [
        {
          intents,
          code: fileContent,
          startLine: 1,
        },
      ];
    }

    // Group by ranges
    const result: Array<{ intents: IntentNode[]; code: string; startLine: number }> = [];

    for (const link of rangeLinks) {
      const intent = intents.find((i) => i.id === link.intentId);
      if (!intent) continue;

      const startLine = link.startLine!;
      const endLine = Math.min(link.endLine!, lines.length);
      const code = lines.slice(startLine - 1, endLine).join("\n");

      // Check if we already have this range
      const existing = result.find((r) => r.startLine === startLine);
      if (existing) {
        if (!existing.intents.find((i) => i.id === intent.id)) {
          existing.intents.push(intent);
        }
      } else {
        result.push({
          intents: [intent],
          code,
          startLine,
        });
      }
    }

    return result;
  }

  private getLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".rb": "ruby",
      ".php": "php",
    };
    return langMap[ext] ?? "text";
  }

  /**
   * Detect drift using git diff output (more efficient than full file)
   */
  private async detectInDiff(
    fileUri: string,
    diff: string,
    intents: IntentNode[],
    language: string
  ): Promise<DriftDetectionResult> {
    const fileName = fileUri.split("/").pop() || fileUri;
    const filePath = fileUri.replace(/^file:\/\//, "");
    
    // Extract the changed code from the diff (+ lines with context)
    const changedCode = this.extractChangedCodeFromDiff(diff);
    
    if (!changedCode.trim()) {
      return { events: [], intentsChecked: intents.length };
    }

    this.log(`🔍 Checking diff for ${fileName} (${changedCode.split("\n").length} lines)`);

    const params: DriftCheckParams = {
      intents,
      code: changedCode,
      filePath,
      language,
    };

    try {
      const analysis = await this.llmService.detectDrift(params);
      
      if (analysis.violations.length > 0) {
        this.log(`🚨 Found ${analysis.violations.length} violation(s) in ${fileName}`);
      }

      const allEvents: DriftEvent[] = [];

      for (const violation of analysis.violations) {
        const intent = intents.find((i) => i.id === violation.intentId);

        const event = createDriftEvent({
          fileUri,
          range: {
            startLine: violation.lineStart,
            endLine: violation.lineEnd,
            startCharacter: 0,
            endCharacter: 0,
          },
          severity: violation.severity,
          summary: violation.summary,
          explanation: violation.explanation,
          intentIds: intent ? [intent.id] : [],
          suggestedFix: violation.suggestedFix,
          confidence: violation.confidence,
        });

        allEvents.push(event);
      }

      return { events: allEvents, intentsChecked: intents.length };
    } catch (error) {
      this.log(`⚠️  Error analyzing diff for ${fileName}:`, error);
      return { events: [], intentsChecked: intents.length };
    }
  }

  /**
   * Extract the new/changed code from a git diff
   * Returns lines with absolute line numbers prefixed (e.g., "42: const x = 1")
   */
  private extractChangedCodeFromDiff(diff: string): string {
    const diffLines = diff.split("\n");
    const result: string[] = [];
    
    let currentLine = 0; // Tracks current line number in the new file
    
    for (const line of diffLines) {
      // Parse hunk headers to get line numbers: @@ -oldStart,oldCount +newStart,newCount @@
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentLine = parseInt(match[1], 10);
        }
        continue;
      }
      
      // Skip other diff headers
      if (line.startsWith("diff --git") || 
          line.startsWith("index ") || 
          line.startsWith("---") || 
          line.startsWith("+++")) {
        continue;
      }
      
      // Added lines (new code) - include with line number
      if (line.startsWith("+")) {
        result.push(`${currentLine}: ${line.slice(1)}`);
        currentLine++;
      }
      // Context lines (unchanged) - include with line number
      else if (line.startsWith(" ")) {
        result.push(`${currentLine}: ${line.slice(1)}`);
        currentLine++;
      }
      // Removed lines - skip but don't increment (they're not in new file)
      // Other lines (empty, etc.) - skip
    }
    
    return result.join("\n");
  }
}
