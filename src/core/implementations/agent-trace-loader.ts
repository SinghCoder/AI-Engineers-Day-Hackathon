/**
 * Agent Trace based conversation loader
 * Reads .agent-trace/traces.jsonl and maps to conversations
 */

import * as fs from "fs/promises";
import * as path from "path";
import { ConversationLoader, LoadedConversation } from "../intent-mesh-core";
import { ConversationMessage } from "../llm-service";
import { LogFn } from "../types";

// Agent Trace schema types (from agent-trace.dev spec)
interface TraceRecord {
  version: string;
  id: string;
  timestamp: string;
  vcs?: {
    type: "git" | "jj" | "hg" | "svn";
    revision: string;
  };
  tool?: {
    name: string;
    version?: string;
  };
  files: FileEntry[];
  metadata?: Record<string, unknown>;
}

interface FileEntry {
  path: string;
  conversations: ConversationEntry[];
}

interface ConversationEntry {
  url?: string;
  contributor?: {
    type: "human" | "ai" | "mixed" | "unknown";
    model_id?: string;
  };
  ranges: RangeEntry[];
  related?: Array<{ type: string; url: string }>;
}

interface RangeEntry {
  start_line: number;
  end_line: number;
  content_hash?: string;
  contributor?: {
    type: "human" | "ai" | "mixed" | "unknown";
    model_id?: string;
  };
}

// Internal types for tracking file->conversation mappings
interface FileConversationMapping {
  filePath: string;
  conversationId: string;
  conversationUrl?: string;
  ranges: Array<{ startLine: number; endLine: number }>;
  modelId?: string;
  timestamp?: string;
}

export interface CursorConversationProvider {
  getConversationById(composerId: string): Promise<{
    messages: ConversationMessage[];
    name?: string;
    projectPath?: string;
  } | null>;
}

export class AgentTraceConversationLoader implements ConversationLoader {
  private traceFilePath: string;
  private mappings: FileConversationMapping[] = [];
  private loaded = false;
  private log: LogFn;

  constructor(
    private readonly workspaceRoot: string,
    private readonly conversationProvider?: CursorConversationProvider,
    logFn?: LogFn
  ) {
    this.traceFilePath = path.join(workspaceRoot, ".agent-trace", "traces.jsonl");
    this.log = logFn ?? console.log;
  }

  /**
   * Load and parse the traces.jsonl file
   */
  private async loadTraces(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await fs.readFile(this.traceFilePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const trace = JSON.parse(line) as TraceRecord;
          this.processTrace(trace);
        } catch (e) {
          this.log("Failed to parse trace line:", e);
        }
      }

      this.loaded = true;
      this.log(`Loaded ${this.mappings.length} file-conversation mappings from agent-trace`);
    } catch (error) {
      this.log("Agent trace file not found or not readable:", this.traceFilePath);
      this.loaded = true; // Mark as loaded to avoid retry
    }
  }

  /**
   * Process a single trace record and extract file->conversation mappings
   */
  private processTrace(trace: TraceRecord): void {
    for (const file of trace.files) {
      const filePath = path.isAbsolute(file.path)
        ? file.path
        : path.join(this.workspaceRoot, file.path);

      for (const convo of file.conversations) {
        // Extract conversation ID from URL or metadata
        const conversationId = this.extractConversationId(convo, trace);
        if (!conversationId) continue;

        const ranges = convo.ranges.map(r => ({
          startLine: r.start_line,
          endLine: r.end_line,
        }));

        // Check if we already have this file-conversation mapping
        const existing = this.mappings.find(
          m => m.filePath === filePath && m.conversationId === conversationId
        );

        if (existing) {
          // Merge ranges
          existing.ranges.push(...ranges);
        } else {
          this.mappings.push({
            filePath,
            conversationId,
            conversationUrl: convo.url,
            ranges,
            modelId: convo.contributor?.model_id,
            timestamp: trace.timestamp,
          });
        }
      }
    }
  }

  /**
   * Extract conversation ID from various sources in the trace
   */
  private extractConversationId(convo: ConversationEntry, trace: TraceRecord): string | null {
    // 1. Try conversation URL
    if (convo.url) {
      // Handle cursor://composer/xxx format
      const cursorMatch = convo.url.match(/cursor:\/\/composer\/([a-f0-9-]+)/i);
      if (cursorMatch) return cursorMatch[1];

      // Handle file:// transcript paths
      if (convo.url.startsWith("file://")) {
        // Extract ID from path if possible
        const pathMatch = convo.url.match(/([a-f0-9-]{36})/i);
        if (pathMatch) return pathMatch[1];
      }

      // Handle API URLs like https://api.cursor.com/v1/conversations/xxx
      const apiMatch = convo.url.match(/conversations?\/([a-f0-9-]+)/i);
      if (apiMatch) return apiMatch[1];
    }

    // 2. Try metadata
    const metadata = trace.metadata as Record<string, unknown> | undefined;
    if (metadata?.conversation_id) {
      return String(metadata.conversation_id);
    }

    // 3. Use trace ID as fallback (less ideal but maintains uniqueness)
    return null;
  }

  /**
   * Load conversations that touched the specified files
   */
  async loadConversationsForFiles(files: string[]): Promise<LoadedConversation[]> {
    await this.loadTraces();

    const normalizedFiles = new Set(
      files.map(f => f.replace(/^file:\/\//, "").replace(/\\/g, "/"))
    );

    // Find all conversation IDs that touched these files
    const conversationMap = new Map<string, {
      id: string;
      url?: string;
      fileRanges: Array<{ filePath: string; startLine: number; endLine: number }>;
    }>();

    for (const mapping of this.mappings) {
      const normalizedPath = mapping.filePath.replace(/\\/g, "/");
      
      // Check if this mapping's file is in our set
      const matches = [...normalizedFiles].some(f => 
        normalizedPath === f || normalizedPath.endsWith(f) || f.endsWith(normalizedPath)
      );

      if (matches) {
        const existing = conversationMap.get(mapping.conversationId);
        if (existing) {
          // Add file ranges
          for (const range of mapping.ranges) {
            existing.fileRanges.push({
              filePath: mapping.filePath,
              startLine: range.startLine,
              endLine: range.endLine,
            });
          }
        } else {
          conversationMap.set(mapping.conversationId, {
            id: mapping.conversationId,
            url: mapping.conversationUrl,
            fileRanges: mapping.ranges.map(r => ({
              filePath: mapping.filePath,
              startLine: r.startLine,
              endLine: r.endLine,
            })),
          });
        }
      }
    }

    // Load actual conversation content
    const result: LoadedConversation[] = [];

    for (const [id, info] of conversationMap) {
      const loaded = await this.loadConversationById(id);
      if (loaded) {
        // Merge file ranges from trace
        loaded.fileRanges = info.fileRanges;
        result.push(loaded);
      }
    }

    this.log(`Found ${result.length} conversations for ${files.length} files`);
    return result;
  }

  /**
   * Load a specific conversation by ID
   */
  async loadConversationById(id: string): Promise<LoadedConversation | null> {
    if (!this.conversationProvider) {
      this.log("No conversation provider configured");
      return null;
    }

    const convo = await this.conversationProvider.getConversationById(id);
    if (!convo) {
      this.log(`Conversation ${id} not found`);
      return null;
    }

    return {
      id,
      name: convo.name,
      messages: convo.messages,
      projectPath: convo.projectPath,
    };
  }

  /**
   * Get all conversation IDs that touched a specific file
   */
  async getConversationIdsForFile(filePath: string): Promise<string[]> {
    await this.loadTraces();

    const normalizedPath = filePath.replace(/^file:\/\//, "").replace(/\\/g, "/");
    
    return this.mappings
      .filter(m => {
        const mappingPath = m.filePath.replace(/\\/g, "/");
        return mappingPath === normalizedPath || 
               mappingPath.endsWith(normalizedPath) ||
               normalizedPath.endsWith(mappingPath);
      })
      .map(m => m.conversationId);
  }

  /**
   * Get all file ranges associated with a conversation
   */
  async getFileRangesForConversation(conversationId: string): Promise<
    Array<{ filePath: string; startLine: number; endLine: number }>
  > {
    await this.loadTraces();

    const ranges: Array<{ filePath: string; startLine: number; endLine: number }> = [];

    for (const mapping of this.mappings) {
      if (mapping.conversationId === conversationId) {
        for (const range of mapping.ranges) {
          ranges.push({
            filePath: mapping.filePath,
            startLine: range.startLine,
            endLine: range.endLine,
          });
        }
      }
    }

    return ranges;
  }
}
