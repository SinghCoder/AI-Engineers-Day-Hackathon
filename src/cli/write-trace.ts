#!/usr/bin/env node
/**
 * Utility to write agent-trace record from the last Cursor conversation
 * 
 * Usage: npx intentmesh-trace [workspace-path]
 * 
 * Finds the most recent Cursor conversation for this workspace,
 * gets the git diff, and writes a trace linking files to the conversation.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { randomUUID } from "crypto";

interface ComposerData {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  projectPath?: string;
}

interface TraceRecord {
  version: string;
  id: string;
  timestamp: string;
  tool: { name: string; version?: string };
  vcs?: { type: string; revision: string };
  files: Array<{
    path: string;
    conversations: Array<{
      url: string;
      contributor: { type: string };
      ranges: Array<{ start_line: number; end_line: number }>;
    }>;
  }>;
}

function getCursorRoot(): string {
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

function getCursorDbPath(): string {
  return path.join(getCursorRoot(), "User", "globalStorage", "state.vscdb");
}

function runSqlite(dbPath: string, query: string): any[] {
  const tmpFile = path.join(os.tmpdir(), `trace-sqlite-${Date.now()}.json`);
  try {
    execSync(
      `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}" > "${tmpFile}"`,
      { encoding: "utf-8", shell: "/bin/bash" }
    );
    const result = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);
    return JSON.parse(result || "[]");
  } catch {
    try { fs.unlinkSync(tmpFile); } catch {}
    return [];
  }
}

function getChangedFiles(workspaceRoot: string): string[] {
  try {
    // Get files changed since last commit (staged + unstaged)
    const result = execSync("git diff --name-only HEAD 2>/dev/null || git diff --name-only", {
      cwd: workspaceRoot,
      encoding: "utf-8",
    }).trim();
    
    if (!result) return [];
    return result.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getFileLineCount(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function getCurrentRevision(workspaceRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: workspaceRoot, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function extractProjectPathFromWorkspace(dbPath: string): string | undefined {
  try {
    const rows = runSqlite(
      dbPath,
      `SELECT value FROM ItemTable WHERE key = 'history.entries' LIMIT 1`
    );

    if (rows.length === 0 || !rows[0].value) return undefined;

    const entries = JSON.parse(rows[0].value);
    const paths: string[] = [];

    if (Array.isArray(entries)) {
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
      // Find common prefix
      let prefix = paths[0];
      for (let i = 1; i < paths.length; i++) {
        while (paths[i].indexOf(prefix) !== 0) {
          prefix = prefix.slice(0, -1);
          if (prefix === "") return undefined;
        }
      }
      const lastSlash = prefix.lastIndexOf("/");
      if (lastSlash > 0) {
        return prefix.slice(0, lastSlash);
      }
    }
  } catch {}
  return undefined;
}

function buildComposerToWorkspaceMap(): Map<string, { wsId: string; projectPath?: string }> {
  const map = new Map<string, { wsId: string; projectPath?: string }>();
  const workspaceStoragePath = path.join(getCursorRoot(), "User", "workspaceStorage");

  try {
    const workspaces = fs.readdirSync(workspaceStoragePath);

    for (const wsId of workspaces) {
      const dbPath = path.join(workspaceStoragePath, wsId, "state.vscdb");
      if (!fs.existsSync(dbPath)) continue;

      const projectPath = extractProjectPathFromWorkspace(dbPath);

      // Get workspace composer data
      const wsComposerData = runSqlite(
        dbPath,
        "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
      );

      if (wsComposerData.length > 0 && wsComposerData[0].value) {
        try {
          const data = JSON.parse(wsComposerData[0].value);
          for (const comp of data.allComposers ?? []) {
            if (comp.composerId) {
              map.set(comp.composerId, { wsId, projectPath });
            }
          }
        } catch {}
      }
    }
  } catch {}

  return map;
}

function findLastConversationForWorkspace(workspaceRoot: string): ComposerData | null {
  const dbPath = getCursorDbPath();
  
  if (!fs.existsSync(dbPath)) {
    console.error("Cursor database not found at:", dbPath);
    return null;
  }

  // Build composer -> workspace mapping first
  const composerToWorkspace = buildComposerToWorkspaceMap();
  console.log(`  (Scanned ${composerToWorkspace.size} workspace-composer mappings)`);

  // Get all recent composers
  const rows = runSqlite(
    dbPath,
    `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT 50`
  );

  const normalizedWorkspace = workspaceRoot.toLowerCase();
  const workspaceBasename = path.basename(workspaceRoot).toLowerCase();

  for (const row of rows) {
    try {
      const data = JSON.parse(row.value) as ComposerData;
      const composerId = row.key.split(":")[1];
      
      // Try workspace mapping first (most reliable)
      const wsInfo = composerToWorkspace.get(composerId);
      const projectPath = wsInfo?.projectPath || data.projectPath || "";
      const normalizedProject = projectPath.toLowerCase();
      const projectBasename = projectPath ? path.basename(projectPath).toLowerCase() : "";

      // Match by path
      const matches =
        (normalizedProject && (normalizedWorkspace.includes(normalizedProject) || normalizedProject.includes(normalizedWorkspace))) ||
        (projectBasename && projectBasename === workspaceBasename);

      if (matches) {
        data.composerId = composerId;
        data.projectPath = projectPath; // Use resolved path
        return data;
      }
    } catch {}
  }

  return null;
}

function writeTrace(workspaceRoot: string): void {
  console.log("🔍 Finding last Cursor conversation for:", workspaceRoot);

  // Step 1: Find matching conversation
  const conversation = findLastConversationForWorkspace(workspaceRoot);
  
  if (!conversation) {
    console.error("❌ No Cursor conversation found for this workspace");
    console.log("   Make sure you have an active Cursor session for this project");
    process.exit(1);
  }

  console.log(`✓ Found conversation: "${conversation.name || conversation.composerId}"`);
  console.log(`  Last updated: ${new Date(conversation.lastUpdatedAt || 0).toISOString()}`);

  // Step 2: Get changed files
  const changedFiles = getChangedFiles(workspaceRoot);
  
  if (changedFiles.length === 0) {
    console.error("❌ No changed files detected (git diff is empty)");
    console.log("   Make changes to files before running this command");
    process.exit(1);
  }

  console.log(`✓ Found ${changedFiles.length} changed file(s):`);
  changedFiles.forEach(f => console.log(`  - ${f}`));

  // Step 3: Build trace record
  const trace: TraceRecord = {
    version: "0.1.0",
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    tool: { name: "cursor" },
    files: changedFiles.map(relPath => {
      const absPath = path.join(workspaceRoot, relPath);
      const lineCount = getFileLineCount(absPath);
      
      return {
        path: relPath,
        conversations: [{
          url: `cursor://composer/${conversation.composerId}`,
          contributor: { type: "ai" },
          ranges: [{ start_line: 1, end_line: lineCount || 1 }],
        }],
      };
    }),
  };

  // Add VCS info
  const revision = getCurrentRevision(workspaceRoot);
  if (revision) {
    trace.vcs = { type: "git", revision };
  }

  // Step 4: Write to traces.jsonl
  const traceDir = path.join(workspaceRoot, ".agent-trace");
  const traceFile = path.join(traceDir, "traces.jsonl");

  if (!fs.existsSync(traceDir)) {
    fs.mkdirSync(traceDir, { recursive: true });
    console.log(`✓ Created ${traceDir}`);
  }

  fs.appendFileSync(traceFile, JSON.stringify(trace) + "\n");
  
  console.log(`\n✅ Wrote trace to ${traceFile}`);
  console.log(`   Trace ID: ${trace.id}`);
  console.log(`   Linked ${changedFiles.length} file(s) to conversation ${conversation.composerId}`);
}

function listRecentConversations(): void {
  const dbPath = getCursorDbPath();
  
  if (!fs.existsSync(dbPath)) {
    console.error("Cursor database not found");
    process.exit(1);
  }

  // Build workspace mapping first
  const composerToWorkspace = buildComposerToWorkspaceMap();
  console.log(`(Scanned ${composerToWorkspace.size} workspace-composer mappings)\n`);

  const rows = runSqlite(
    dbPath,
    `SELECT key, json_extract(value, '$.name') as name, json_extract(value, '$.projectPath') as projectPath, json_extract(value, '$.lastUpdatedAt') as lastUpdated FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY lastUpdated DESC LIMIT 10`
  );

  console.log("Recent Cursor conversations:\n");
  for (const row of rows) {
    const id = row.key.split(":")[1];
    const date = row.lastUpdated ? new Date(row.lastUpdated).toLocaleString() : "unknown";
    
    // Resolve project path from workspace mapping
    const wsInfo = composerToWorkspace.get(id);
    const resolvedPath = wsInfo?.projectPath || row.projectPath;
    
    console.log(`  ${id}`);
    console.log(`    Name: ${row.name || "(unnamed)"}`);
    console.log(`    Project: ${resolvedPath || "(none)"}`);
    console.log(`    Updated: ${date}\n`);
  }

  console.log("Usage: intentmesh-trace [workspace] --conversation <id>");
}

function writeTraceWithConversationId(workspaceRoot: string, composerId: string): void {
  console.log("🔍 Using specified conversation:", composerId);

  // Verify conversation exists
  const dbPath = getCursorDbPath();
  const rows = runSqlite(
    dbPath,
    `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${composerId}' LIMIT 1`
  );

  if (rows.length === 0) {
    console.error("❌ Conversation not found:", composerId);
    process.exit(1);
  }

  const data = JSON.parse(rows[0].value) as ComposerData;
  data.composerId = composerId;

  console.log(`✓ Found conversation: "${data.name || composerId}"`);

  // Get changed files
  const changedFiles = getChangedFiles(workspaceRoot);
  
  if (changedFiles.length === 0) {
    console.error("❌ No changed files detected (git diff is empty)");
    process.exit(1);
  }

  console.log(`✓ Found ${changedFiles.length} changed file(s):`);
  changedFiles.forEach(f => console.log(`  - ${f}`));

  // Build and write trace
  const trace: TraceRecord = {
    version: "0.1.0",
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    tool: { name: "cursor" },
    files: changedFiles.map(relPath => {
      const absPath = path.join(workspaceRoot, relPath);
      const lineCount = getFileLineCount(absPath);
      
      return {
        path: relPath,
        conversations: [{
          url: `cursor://composer/${composerId}`,
          contributor: { type: "ai" },
          ranges: [{ start_line: 1, end_line: lineCount || 1 }],
        }],
      };
    }),
  };

  const revision = getCurrentRevision(workspaceRoot);
  if (revision) {
    trace.vcs = { type: "git", revision };
  }

  const traceDir = path.join(workspaceRoot, ".agent-trace");
  const traceFile = path.join(traceDir, "traces.jsonl");

  if (!fs.existsSync(traceDir)) {
    fs.mkdirSync(traceDir, { recursive: true });
  }

  fs.appendFileSync(traceFile, JSON.stringify(trace) + "\n");
  
  console.log(`\n✅ Wrote trace to ${traceFile}`);
  console.log(`   Trace ID: ${trace.id}`);
}

// Main
const args = process.argv.slice(2);

if (args.includes("--list") || args.includes("-l")) {
  listRecentConversations();
  process.exit(0);
}

const conversationIdx = args.findIndex(a => a === "--conversation" || a === "-c");
const conversationId = conversationIdx >= 0 ? args[conversationIdx + 1] : null;

// Filter out flags to get workspace path
const workspaceRoot = args.find(a => !a.startsWith("-") && a !== conversationId) || process.cwd();

if (!fs.existsSync(workspaceRoot)) {
  console.error("Workspace path does not exist:", workspaceRoot);
  process.exit(1);
}

if (conversationId) {
  writeTraceWithConversationId(path.resolve(workspaceRoot), conversationId);
} else {
  writeTrace(path.resolve(workspaceRoot));
}
