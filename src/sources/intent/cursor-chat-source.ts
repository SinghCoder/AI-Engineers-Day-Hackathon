import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { execSync } from "child_process";
import {
  IIntentSource,
  RawIntent,
  ExtractOptions,
} from "../../core/intent-source";
import { ILLMService, ConversationMessage } from "../../core/llm-service";

interface ComposerSession {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  messages: ConversationMessage[];
  workspaceId?: string;
  projectPath?: string;
}

export type LogFn = (message: string, ...args: any[]) => void;

export class CursorChatSource implements IIntentSource {
  readonly id = "cursor-chat";
  readonly name = "Cursor Chat History";
  readonly type = "conversation" as const;

  private cursorRoot: string;
  private log: LogFn;

  constructor(
    private readonly llmService: ILLMService,
    private readonly workspaceRoot: string,
    logFn?: LogFn
  ) {
    this.cursorRoot = this.getCursorRoot();
    this.log = logFn ?? console.log;
  }

  private getCursorRoot(): string {
    const home = os.homedir();
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Cursor");
      case "win32":
        return path.join(home, "AppData", "Roaming", "Cursor");
      default:
        return path.join(home, ".config", "Cursor");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(this.cursorRoot);
      return true;
    } catch {
      return false;
    }
  }

  async extractIntents(options?: ExtractOptions): Promise<RawIntent[]> {
    const sessions = await this.extractSessions();
    
    // Filter to sessions related to current workspace
    const relevantSessions = sessions.filter(s => 
      s.projectPath && this.workspaceRoot.includes(path.basename(s.projectPath))
    );

    const allIntents: RawIntent[] = [];

    for (const session of relevantSessions.slice(0, options?.maxIntents ?? 10)) {
      if (session.messages.length < 2) continue;

      const extracted = await this.llmService.extractIntents(session.messages);

      for (const intent of extracted) {
        allIntents.push({
          title: intent.title,
          statement: intent.statement,
          confidence: intent.confidence,
          evidence: [
            {
              type: "quote",
              content: intent.evidence,
            },
          ],
          suggestedTags: intent.tags,
          sourceRef: {
            sourceId: session.composerId,
            sourceType: "conversation",
            uri: `cursor://composer/${session.composerId}`,
            timestamp: session.lastUpdatedAt ? new Date(session.lastUpdatedAt) : new Date(),
            metadata: {
              composerName: session.name,
              projectPath: session.projectPath,
              workspaceId: session.workspaceId,
            },
          },
        });
      }
    }

    return allIntents;
  }

  /**
   * Run sqlite3 CLI command and return JSON result
   */
  private runSqlite(dbPath: string, query: string): any[] {
    const tmpFile = path.join(os.tmpdir(), `intentmesh-sqlite-${Date.now()}.json`);
    try {
      // Write to temp file to avoid buffer issues
      execSync(
        `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}" > "${tmpFile}"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      const result = require("fs").readFileSync(tmpFile, "utf-8");
      require("fs").unlinkSync(tmpFile);
      return JSON.parse(result || "[]");
    } catch (error) {
      try { require("fs").unlinkSync(tmpFile); } catch {}
      this.log(`SQLite query failed for ${dbPath}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Extract all composer sessions from Cursor databases
   */
  async extractSessions(): Promise<ComposerSession[]> {
    const sessions = new Map<string, ComposerSession>();

    this.log("Cursor root:", this.cursorRoot);

    // First, build a mapping of composerId -> workspace info by scanning workspace DBs
    const composerToWorkspace = new Map<string, { wsId: string; projectPath?: string }>();
    const workspaceStoragePath = path.join(this.cursorRoot, "User", "workspaceStorage");
    
    try {
      const workspaces = await fs.readdir(workspaceStoragePath);
      
      for (const wsId of workspaces) {
        const dbPath = path.join(workspaceStoragePath, wsId, "state.vscdb");
        try {
          await fs.access(dbPath);
          
          // Get project path for this workspace
          const projectPath = this.extractProjectPathFromWorkspace(dbPath);
          this.log(`Workspace ${wsId.slice(0, 8)} project path:`, projectPath);
          
          // Check for workspace composer data
          const wsComposerData = this.runSqlite(
            dbPath,
            "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
          );
          
          if (wsComposerData.length > 0 && wsComposerData[0].value) {
            try {
              const data = JSON.parse(wsComposerData[0].value);
              for (const comp of data.allComposers ?? []) {
                if (comp.composerId) {
                  composerToWorkspace.set(comp.composerId, { wsId, projectPath });
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        } catch (err) {
          this.log(`Failed to process workspace ${wsId}:`, err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      this.log("workspaceStorage read error:", err instanceof Error ? err.message : String(err));
    }
    
    this.log("Mapped composers to workspaces:", composerToWorkspace.size);

    // Now extract from global database
    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");
    this.log("Checking global DB:", globalDbPath);
    
    try {
      await fs.access(globalDbPath);
      
      // Get composer metadata (smaller query - just keys and basic info)
      const composerRows = this.runSqlite(
        globalDbPath,
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT 50"
      );
      this.log("Found composerData entries (limited to 50 most recent):", composerRows.length);

      // OPTIMIZATION: Fetch ALL bubbles at once instead of per-composer
      const allBubbleRows = this.runSqlite(
        globalDbPath,
        `SELECT key, json_extract(value, '$.type') as type, json_extract(value, '$.text') as text FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 10000`
      );
      
      // Index all bubbles by key for O(1) lookup
      const bubbleMap = new Map<string, { type: number; text: string }>();
      for (const b of allBubbleRows) {
        bubbleMap.set(b.key, { type: b.type, text: b.text });
      }
      this.log("Fetched bubbles:", allBubbleRows.length);

      let processedCount = 0;
      for (const row of composerRows) {
        try {
          const composerId = row.key.split(":")[1];
          const data = JSON.parse(row.value);
          
          // Get bubble headers which contain the conversation order
          const headers = data.fullConversationHeadersOnly ?? [];
          if (headers.length === 0) continue;
          
          // Look up bubbles from the cached map (already fetched above)
          const messages: ConversationMessage[] = [];
          // Limit to first 20 messages to avoid huge conversations
          for (const header of headers.slice(0, 20)) {
            const bubbleKey = `bubbleId:${composerId}:${header.bubbleId}`;
            const bubble = bubbleMap.get(bubbleKey);
            if (bubble && bubble.text?.trim()) {
              const role = bubble.type === 1 ? "user" : "assistant";
              messages.push({ role, content: bubble.text.trim() });
            }
          }
          
          if (messages.length >= 2) {
            // Look up workspace info for this composer
            const wsInfo = composerToWorkspace.get(composerId);
            
            // Determine project path - prefer workspace mapping, then data.projectPath, then infer from name
            let projectPath = wsInfo?.projectPath || data.projectPath;
            if (!projectPath && data.name) {
              // Try to extract project-like name from session name
              const match = data.name.match(/^\[.*?\]\s*(.+)/) || [, data.name];
              projectPath = match[1] || data.name;
            }
            
            this.log(`Composer ${composerId.slice(0, 8)}: name="${data.name}", projectPath="${projectPath}"`);
            
            sessions.set(composerId, {
              composerId,
              name: data.name || data.title,
              createdAt: data.createdAt,
              lastUpdatedAt: data.lastUpdatedAt,
              messages,
              workspaceId: wsInfo?.wsId || "global",
              projectPath,
            });
            processedCount++;
          }
        } catch (parseError) {
          // Skip malformed entries
        }
      }
      this.log("Composers with messages:", processedCount);

      // Method 2: Get metadata from ItemTable
      const metaRows = this.runSqlite(
        globalDbPath,
        "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
      );
      
      if (metaRows.length > 0 && metaRows[0].value) {
        try {
          const metaData = JSON.parse(metaRows[0].value);
          for (const comp of metaData.allComposers ?? []) {
            const existing = sessions.get(comp.composerId);
            if (existing) {
              existing.name = existing.name || comp.name;
              existing.createdAt = existing.createdAt || comp.createdAt;
              existing.lastUpdatedAt = existing.lastUpdatedAt || comp.lastUpdatedAt;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

    } catch (error) {
      this.log("Global database not accessible:", error);
    }

    this.log("Total sessions extracted:", sessions.size);

    // Sort by last updated
    const result = Array.from(sessions.values());
    result.sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0));

    return result;
  }

  private extractMessagesFromComposer(data: any): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    
    // Try different field names Cursor uses
    const conversation = data.conversation ?? data.messages ?? data.bubbles ?? [];
    
    for (const msg of conversation) {
      let role: "user" | "assistant";
      
      // Handle different formats
      if (msg.type === 1 || msg.role === "user" || msg.type === "user") {
        role = "user";
      } else {
        role = "assistant";
      }
      
      const content = msg.text || msg.content || msg.richText || "";
      
      if (content.trim()) {
        messages.push({ role, content });
      }
    }

    return messages;
  }

  private extractProjectPathFromWorkspace(dbPath: string): string | undefined {
    try {
      // Try history.entries key (most reliable)
      const rows = this.runSqlite(
        dbPath,
        `SELECT value FROM ItemTable WHERE key = 'history.entries' LIMIT 1`
      );

      if (rows.length === 0 || !rows[0].value) return undefined;

      try {
        const entries = JSON.parse(rows[0].value);
        const paths: string[] = [];

        // Handle array format
        if (Array.isArray(entries)) {
          // Only process first 10 to avoid scanning entire history
          for (const entry of entries.slice(0, 10)) {
            const resource = entry?.editor?.resource ?? entry?.resource ?? entry?.path ?? "";
            if (typeof resource === "string" && resource.startsWith("file://")) {
              paths.push(resource.slice(7));
            } else if (typeof entry === "string" && entry.startsWith("/")) {
              paths.push(entry);
            }
          }
        }

        if (paths.length > 0) {
          const commonPrefix = this.longestCommonPrefix(paths);
          const lastSlash = commonPrefix.lastIndexOf("/");
          if (lastSlash > 0) {
            return commonPrefix.slice(0, lastSlash);
          }
        }
      } catch {
        return undefined;
      }
      
      return undefined;
    } catch (err) {
      this.log("Error extracting project path:", err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  private longestCommonPrefix(strs: string[]): string {
    if (strs.length === 0) return "";
    let prefix = strs[0];
    for (let i = 1; i < strs.length; i++) {
      while (strs[i].indexOf(prefix) !== 0) {
        prefix = prefix.slice(0, -1);
        if (prefix === "") return "";
      }
    }
    return prefix;
  }

  /**
   * Get sessions for a specific workspace/project
   */
  async getSessionsForWorkspace(workspacePath: string): Promise<ComposerSession[]> {
    const allSessions = await this.extractSessions();
    const projectName = path.basename(workspacePath);
    
    return allSessions.filter(s => 
      s.projectPath?.includes(projectName) ||
      s.name?.toLowerCase().includes(projectName.toLowerCase())
    );
  }
}
