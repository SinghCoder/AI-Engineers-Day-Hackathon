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

  /**
   * Load bubbles for a specific conversation directly from DB
   * This avoids the cache limit issue (47k+ bubbles total)
   */
  private loadBubblesForConversation(composerId: string): Map<string, { type: number; text: string }> {
    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");
    const bubbles = new Map<string, { type: number; text: string }>();
    
    try {
      const rows = this.runSqlite(
        globalDbPath,
        `SELECT key, json_extract(value, '$.type') as type, json_extract(value, '$.text') as text FROM cursorDiskKV WHERE key LIKE 'bubbleId:${composerId}:%'`
      );

      for (const b of rows) {
        bubbles.set(b.key, { type: b.type, text: b.text });
      }

    } catch {
      // Bubbles not found - conversation may be incomplete
    }
    
    return bubbles;
  }



  async getConversationById(composerId: string): Promise<{
    messages: ConversationMessage[];
    name?: string;
    projectPath?: string;
  } | null> {
    return this.tryGetConversation(composerId);
  }

  private async tryGetConversation(composerId: string): Promise<{
    messages: ConversationMessage[];
    name?: string;
    projectPath?: string;
  } | null> {
    const globalDbPath = path.join(this.cursorRoot, "User", "globalStorage", "state.vscdb");
    this.log(`🔍 Looking for conversation ${composerId} in ${globalDbPath}`);

    try {
      // Get composer data
      const composerRows = this.runSqlite(
        globalDbPath,
        `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${composerId}' LIMIT 1`
      );

      if (composerRows.length === 0) {
        this.log(`❌ No composerData found for ${composerId}`);
        return null;
      }

      const data = JSON.parse(composerRows[0].value) as ComposerData;
      const headers = data.fullConversationHeadersOnly ?? [];
      this.log(`📋 Found ${headers.length} bubble headers for conversation`);

      if (headers.length === 0) {
        this.log(`❌ No bubble headers in conversation`);
        return null;
      }

      // Load bubbles directly for this conversation (avoids cache limit issue)
      const bubbles = this.loadBubblesForConversation(composerId);
      this.log(`💬 Loaded ${bubbles.size} bubbles from DB`);

      // Build messages from bubbles
      const messages: ConversationMessage[] = [];
      for (const header of headers.slice(0, 50)) { // Limit to 50 messages
        const bubbleKey = `bubbleId:${composerId}:${header.bubbleId}`;
        const bubble = bubbles.get(bubbleKey);
        
        if (bubble && bubble.text?.trim()) {
          const role = bubble.type === 1 ? "user" : "assistant";
          messages.push({ role, content: bubble.text.trim() });
        }
      }

      if (messages.length < 2) {
        this.log(`❌ Only ${messages.length} messages found (need at least 2)`);
        return null;
      }
      
      this.log(`🔗 Loaded Cursor conversation: "${data.name || composerId.slice(0, 8)}" (${messages.length} messages)`);

      return {
        messages,
        name: data.name,
        projectPath: data.projectPath,
      };
    } catch {
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
