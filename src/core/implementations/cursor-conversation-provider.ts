/**
 * Cursor conversation provider - extracts conversations from Cursor's SQLite DB
 * This is a refactored version of cursor-chat-source.ts for the core layer
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { execSync } from "child_process";
import { CursorConversationProvider } from "./agent-trace-loader";
import { ConversationMessage } from "../llm-service";
import { LogFn } from "../types";

interface ComposerData {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  projectPath?: string;
  fullConversationHeadersOnly?: Array<{ bubbleId: string }>;
}

export class CursorConversationProviderImpl implements CursorConversationProvider {
  private cursorRoot: string;
  private bubbleCache: Map<string, { type: number; text: string }> | null = null;
  private log: LogFn;

  constructor(logFn?: LogFn) {
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

  private runSqlite(dbPath: string, query: string): any[] {
    const tmpFile = path.join(os.tmpdir(), `intentmesh-sqlite-${Date.now()}.json`);
    try {
      execSync(
        `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}" > "${tmpFile}"`,
        { encoding: "utf-8", shell: "/bin/bash" }
      );
      const result = require("fs").readFileSync(tmpFile, "utf-8");
      require("fs").unlinkSync(tmpFile);
      return JSON.parse(result || "[]");
    } catch (error) {
      try { require("fs").unlinkSync(tmpFile); } catch {}
      return [];
    }
  }

  private async ensureBubbleCache(): Promise<void> {
    if (this.bubbleCache) return;

    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");
    
    try {
      await fs.access(globalDbPath);
      
      const allBubbleRows = this.runSqlite(
        globalDbPath,
        `SELECT key, json_extract(value, '$.type') as type, json_extract(value, '$.text') as text FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 10000`
      );

      this.bubbleCache = new Map();
      for (const b of allBubbleRows) {
        this.bubbleCache.set(b.key, { type: b.type, text: b.text });
      }

      this.log(`Cached ${this.bubbleCache.size} Cursor bubbles`);
    } catch {
      this.bubbleCache = new Map();
    }
  }

  async getConversationById(composerId: string): Promise<{
    messages: ConversationMessage[];
    name?: string;
    projectPath?: string;
  } | null> {
    await this.ensureBubbleCache();

    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");

    try {
      // Get composer data
      const composerRows = this.runSqlite(
        globalDbPath,
        `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${composerId}' LIMIT 1`
      );

      if (composerRows.length === 0) {
        return null;
      }

      const data = JSON.parse(composerRows[0].value) as ComposerData;
      const headers = data.fullConversationHeadersOnly ?? [];

      if (headers.length === 0) {
        return null;
      }

      // Build messages from bubble cache
      const messages: ConversationMessage[] = [];
      for (const header of headers.slice(0, 50)) { // Limit to 50 messages
        const bubbleKey = `bubbleId:${composerId}:${header.bubbleId}`;
        const bubble = this.bubbleCache?.get(bubbleKey);
        
        if (bubble && bubble.text?.trim()) {
          const role = bubble.type === 1 ? "user" : "assistant";
          messages.push({ role, content: bubble.text.trim() });
        }
      }

      if (messages.length < 2) {
        return null;
      }

      return {
        messages,
        name: data.name,
        projectPath: data.projectPath,
      };
    } catch (error) {
      this.log(`Failed to load conversation ${composerId}:`, error);
      return null;
    }
  }

  /**
   * Get all recent composer IDs (for discovery)
   */
  async getRecentComposerIds(limit: number = 20): Promise<string[]> {
    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");

    try {
      const composerRows = this.runSqlite(
        globalDbPath,
        `SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT ${limit}`
      );

      return composerRows.map(row => row.key.split(":")[1]);
    } catch {
      return [];
    }
  }
}
