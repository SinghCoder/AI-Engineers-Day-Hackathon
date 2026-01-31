import * as fs from "fs/promises";
import * as path from "path";
import { ILLMService, DriftCheckParams } from "../core/llm-service";
import { IIntentStore } from "../core/store";
import { IAttributionSource } from "../core/attribution-source";
import { IntentNode, IntentLink } from "../models/intent";
import { DriftEvent, createDriftEvent, Range } from "../models/drift";
import { IntentLinker } from "./intent-linker";

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
    logFn?: LogFn
  ) {
    this.linker = new IntentLinker(store, attributionSource);
    this.logFn = logFn ?? ((msg, ...args) => console.log(`[DriftDetector] ${msg}`, ...args));
  }

  // Simple logger for debugging
  private log(message: string, ...args: any[]): void {
    this.logFn(message, ...args);
  }

  /**
   * Detect drift in a single file
   */
  async detectInFile(fileUri: string): Promise<DriftDetectionResult> {
    this.log("detectInFile called with:", fileUri);
    
    // Get intents that apply to this file
    const intents = await this.linker.getIntentsForFile(fileUri);
    this.log("Found intents for file:", intents.length, intents.map(i => i.id));
    
    if (intents.length === 0) {
      this.log("No intents found, returning empty");
      return { events: [], intentsChecked: 0 };
    }

    // Read the file content
    const filePath = fileUri.replace(/^file:\/\//, "");
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
      this.log("Read file content, length:", content.length);
    } catch (error) {
      this.log("Failed to read file:", error);
      return { events: [], intentsChecked: 0 };
    }

    // Determine language from extension
    const language = this.getLanguage(filePath);

    // Get links for this file to know which ranges to check
    const links = await this.store.getLinksForFile(fileUri);
    this.log("Found links:", links.length);
    
    // Group intents by the code ranges they apply to
    const rangesToCheck = this.groupByRanges(intents, links, content);
    this.log("Ranges to check:", rangesToCheck.length, rangesToCheck.map(r => ({ 
      startLine: r.startLine, 
      intents: r.intents.map(i => i.id),
      codeLength: r.code.length 
    })));

    const allEvents: DriftEvent[] = [];

    for (const { intents: rangeIntents, code, startLine } of rangesToCheck) {
      // Call LLM to detect drift
      const params: DriftCheckParams = {
        intents: rangeIntents,
        code,
        filePath,
        language,
      };

      this.log("Calling LLM with params:", {
        intentCount: rangeIntents.length,
        intents: rangeIntents.map(i => ({ id: i.id, title: i.title })),
        codePreview: code.substring(0, 200) + "...",
        filePath,
        language
      });

      try {
        const analysis = await this.llmService.detectDrift(params);
        this.log("LLM response - violations:", analysis.violations.length);

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
}
