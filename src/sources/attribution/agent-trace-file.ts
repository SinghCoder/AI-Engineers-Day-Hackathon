import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import {
  IAttributionSource,
  AttributionSpan,
  Contributor,
} from "../../core/attribution-source";

// Agent Trace JSON format (based on agent-trace.dev spec)
interface AgentTraceRecord {
  version: string;
  file: string;
  vcs?: string;
  revision?: string;
  conversations: AgentTraceConversation[];
}

interface AgentTraceConversation {
  url?: string;
  contributor: {
    type: "human" | "ai" | "mixed" | "unknown";
    model?: string;
    tool?: string;
  };
  ranges: Array<{
    start: number;  // 1-indexed line
    end: number;    // 1-indexed line, inclusive
    hash?: string;
  }>;
  timestamp?: string;
  related?: Array<{ url: string; label?: string }>;
  metadata?: Record<string, unknown>;
}

export class AgentTraceFileSource implements IAttributionSource {
  readonly id = "agent-trace-file";
  readonly name = "Agent Trace Files";

  private tracePaths: string[];
  private workspaceRoot: string;
  private spansByFile: Map<string, AttributionSpan[]> = new Map();
  private loaded = false;

  constructor(workspaceRoot: string, tracePaths: string[] = ["**/.agent-trace/**/*.json", "**/*.agent-trace.json"]) {
    this.workspaceRoot = workspaceRoot;
    this.tracePaths = tracePaths;
  }

  async isAvailable(): Promise<boolean> {
    const files = await this.findTraceFiles();
    return files.length > 0;
  }

  async refresh(): Promise<void> {
    this.spansByFile.clear();
    this.loaded = false;
    await this.loadAllTraces();
  }

  async getFileAttribution(fileUri: string): Promise<AttributionSpan[]> {
    if (!this.loaded) {
      await this.loadAllTraces();
    }
    
    const normalizedUri = this.normalizeUri(fileUri);
    return this.spansByFile.get(normalizedUri) ?? [];
  }

  async getRangeAttribution(
    fileUri: string,
    startLine: number,
    endLine: number
  ): Promise<AttributionSpan[]> {
    const fileSpans = await this.getFileAttribution(fileUri);
    
    return fileSpans.filter((span) => {
      // Check if ranges overlap
      return span.startLine <= endLine && span.endLine >= startLine;
    });
  }

  private async loadAllTraces(): Promise<void> {
    const traceFiles = await this.findTraceFiles();
    
    for (const file of traceFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const trace: AgentTraceRecord = JSON.parse(content);
        this.processTraceRecord(trace, file);
      } catch (error) {
        console.error(`Failed to parse trace file ${file}:`, error);
      }
    }
    
    this.loaded = true;
  }

  private async findTraceFiles(): Promise<string[]> {
    const allFiles: string[] = [];
    
    for (const pattern of this.tracePaths) {
      const files = await glob(pattern, {
        cwd: this.workspaceRoot,
        absolute: true,
        ignore: ["**/node_modules/**"],
      });
      allFiles.push(...files);
    }
    
    return [...new Set(allFiles)]; // dedupe
  }

  private processTraceRecord(trace: AgentTraceRecord, traceFilePath: string): void {
    if (!trace.file || !trace.conversations) return;

    // Resolve the file path relative to the trace file location
    const traceDir = path.dirname(traceFilePath);
    const resolvedFile = path.isAbsolute(trace.file)
      ? trace.file
      : path.resolve(traceDir, trace.file);
    
    const fileUri = `file://${resolvedFile}`;
    const normalizedUri = this.normalizeUri(fileUri);

    const existingSpans = this.spansByFile.get(normalizedUri) ?? [];

    for (const conversation of trace.conversations) {
      const contributor: Contributor = {
        type: conversation.contributor.type,
        modelId: conversation.contributor.model,
        toolId: conversation.contributor.tool,
      };

      for (const range of conversation.ranges) {
        const span: AttributionSpan = {
          fileUri: normalizedUri,
          startLine: range.start,
          endLine: range.end,
          contributor,
          conversationUrl: conversation.url,
          timestamp: conversation.timestamp ? new Date(conversation.timestamp) : undefined,
          revision: trace.revision,
          contentHash: range.hash,
        };
        existingSpans.push(span);
      }
    }

    this.spansByFile.set(normalizedUri, existingSpans);
  }

  private normalizeUri(uri: string): string {
    // Remove file:// prefix if present, normalize path
    let normalized = uri.replace(/^file:\/\//, "");
    normalized = path.normalize(normalized);
    return normalized;
  }
}
