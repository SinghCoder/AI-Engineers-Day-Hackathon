/**
 * MCP Server Adapter - exposes IntentMeshCore as an MCP server
 * Can be used by Claude Code, Codex CLI, or any MCP client
 */

import {
  IntentMeshCore,
  IntentMeshCoreConfig,
  IntentMeshCoreDeps,
  AnalyzeResult,
  CaptureResult,
  StateSnapshot,
} from "../../core/intent-mesh-core";
import { IntentNode } from "../../models/intent";
import { DriftEvent } from "../../models/drift";
import { LogFn } from "../../core/types";

// MCP Types (simplified - actual implementation would use @modelcontextprotocol/sdk)
export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * MCP Server for IntentMesh
 * Exposes tools for drift detection, intent capture, and state management
 */
export class IntentMeshMcpServer {
  private log: LogFn;

  constructor(
    private readonly core: IntentMeshCore,
    logFn?: LogFn
  ) {
    this.log = logFn ?? console.log;
  }

  // ============ MCP Tools ============

  getTools(): McpTool[] {
    return [
      {
        name: "intentmesh_analyze",
        description: `Analyze code changes for intent drift. 
Returns any violations where code doesn't match stated intents.
If no drifts found, shows conversations available for intent capture.
Use this FIRST before making code changes to check for existing intents.`,
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Specific files to analyze. If omitted, analyzes git changes.",
            },
            since: {
              type: "string",
              description: "Git ref to compare against (e.g., 'HEAD~5', 'main'). Default: HEAD",
            },
          },
        },
      },
      {
        name: "intentmesh_capture",
        description: `Capture intents from AI conversations that produced recent code.
Only works when there are no unresolved drifts.
Extracts requirements/constraints stated by the user and links them to code.`,
        inputSchema: {
          type: "object",
          properties: {
            conversationIds: {
              type: "array",
              items: { type: "string" },
              description: "Specific conversation IDs to capture from. If omitted, uses conversations from recent changes.",
            },
            autoLink: {
              type: "boolean",
              description: "Automatically link intents to code ranges from agent-trace. Default: true",
            },
          },
        },
      },
      {
        name: "intentmesh_resolve_drift",
        description: `Resolve a drift violation. Use after fixing code or if the drift is a false positive.`,
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "The drift event ID to resolve",
            },
            action: {
              type: "string",
              enum: ["dismiss", "false_positive", "update_intent"],
              description: "How to resolve: dismiss (acknowledge), false_positive (mark as incorrect), update_intent (change the intent)",
            },
            newStatement: {
              type: "string",
              description: "New intent statement (required if action is update_intent)",
            },
          },
          required: ["eventId", "action"],
        },
      },
      {
        name: "intentmesh_get_intents",
        description: `Get all intents in the workspace, optionally filtered by file.`,
        inputSchema: {
          type: "object",
          properties: {
            fileUri: {
              type: "string",
              description: "Filter to intents linked to this file",
            },
          },
        },
      },
      {
        name: "intentmesh_get_drifts",
        description: `Get all active drift violations.`,
        inputSchema: {
          type: "object",
          properties: {
            fileUri: {
              type: "string",
              description: "Filter to drifts in this file",
            },
          },
        },
      },
      {
        name: "intentmesh_link_intent",
        description: `Manually link an intent to a code location.`,
        inputSchema: {
          type: "object",
          properties: {
            intentId: {
              type: "string",
              description: "The intent ID to link",
            },
            fileUri: {
              type: "string",
              description: "The file to link to",
            },
            startLine: {
              type: "number",
              description: "Start line of the code range",
            },
            endLine: {
              type: "number",
              description: "End line of the code range",
            },
          },
          required: ["intentId", "fileUri"],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (name) {
        case "intentmesh_analyze":
          return this.handleAnalyze(args);
        case "intentmesh_capture":
          return this.handleCapture(args);
        case "intentmesh_resolve_drift":
          return this.handleResolveDrift(args);
        case "intentmesh_get_intents":
          return this.handleGetIntents(args);
        case "intentmesh_get_drifts":
          return this.handleGetDrifts(args);
        case "intentmesh_link_intent":
          return this.handleLinkIntent(args);
        default:
          return this.errorResult(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return this.errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleAnalyze(args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.core.analyzeChanges({
      files: args.files as string[] | undefined,
      since: args.since as string | undefined,
    });

    return this.formatAnalyzeResult(result);
  }

  private async handleCapture(args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.core.captureIntents({
      conversationIds: args.conversationIds as string[] | undefined,
      autoLink: args.autoLink !== false,
    });

    return this.formatCaptureResult(result);
  }

  private async handleResolveDrift(args: Record<string, unknown>): Promise<McpToolResult> {
    await this.core.resolveDrift(
      args.eventId as string,
      args.action as "dismiss" | "false_positive" | "update_intent",
      args.newStatement as string | undefined
    );

    return this.textResult(`Drift ${args.eventId} resolved with action: ${args.action}`);
  }

  private async handleGetIntents(args: Record<string, unknown>): Promise<McpToolResult> {
    const fileUri = args.fileUri as string | undefined;
    
    let intents: IntentNode[];
    if (fileUri) {
      const links = await this.core.getLinksForFile(fileUri);
      const intentIds = [...new Set(links.map(l => l.intentId))];
      const allIntents = await this.core.getIntents();
      intents = allIntents.filter(i => intentIds.includes(i.id));
    } else {
      intents = await this.core.getIntents();
    }

    return this.formatIntents(intents);
  }

  private async handleGetDrifts(args: Record<string, unknown>): Promise<McpToolResult> {
    const drifts = await this.core.getDrifts(args.fileUri as string | undefined);
    return this.formatDrifts(drifts);
  }

  private async handleLinkIntent(args: Record<string, unknown>): Promise<McpToolResult> {
    const link = await this.core.linkIntentToFile(
      args.intentId as string,
      args.fileUri as string,
      args.startLine as number | undefined,
      args.endLine as number | undefined
    );

    return this.textResult(`Created link ${link.id} from intent ${args.intentId} to ${args.fileUri}`);
  }

  // ============ MCP Resources ============

  async getResources(): Promise<McpResource[]> {
    const state = await this.core.getState();
    
    return [
      {
        uri: "intentmesh://intents",
        name: "All Intents",
        description: `${state.intents.length} intents in workspace`,
        mimeType: "application/json",
      },
      {
        uri: "intentmesh://drifts",
        name: "Active Drifts",
        description: `${state.drifts.filter(d => d.status === "open").length} active drift violations`,
        mimeType: "application/json",
      },
      {
        uri: "intentmesh://state",
        name: "Full State",
        description: "Complete IntentMesh state (intents, links, drifts)",
        mimeType: "application/json",
      },
    ];
  }

  async readResource(uri: string): Promise<string> {
    const state = await this.core.getState();

    switch (uri) {
      case "intentmesh://intents":
        return JSON.stringify(state.intents, null, 2);
      case "intentmesh://drifts":
        return JSON.stringify(state.drifts, null, 2);
      case "intentmesh://state":
        return JSON.stringify(state, null, 2);
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  // ============ Formatting Helpers ============

  private formatAnalyzeResult(result: AnalyzeResult): McpToolResult {
    const lines: string[] = [];
    
    lines.push(`## Analysis Results`);
    lines.push(`- Files analyzed: ${result.filesAnalyzed}`);
    lines.push(`- Intents checked: ${result.intentsChecked}`);
    lines.push(``);

    if (result.drifts.length > 0) {
      lines.push(`### ⚠️ ${result.drifts.length} Drift Violation(s) Found`);
      lines.push(``);
      
      for (const drift of result.drifts) {
        lines.push(`**${drift.severity.toUpperCase()}**: ${drift.summary}`);
        lines.push(`- File: ${drift.fileUri}`);
        lines.push(`- Lines: ${drift.range.startLine}-${drift.range.endLine}`);
        lines.push(`- ID: ${drift.id}`);
        if (drift.suggestedFix) {
          lines.push(`- Suggested fix: ${drift.suggestedFix}`);
        }
        lines.push(``);
      }

      lines.push(`> Fix these violations or use \`intentmesh_resolve_drift\` before capturing new intents.`);
    } else {
      lines.push(`### ✅ No Drift Detected`);
      lines.push(``);

      if (result.canCapture && result.pendingConversations?.length) {
        lines.push(`Ready to capture intents from ${result.pendingConversations.length} conversation(s):`);
        for (const convo of result.pendingConversations) {
          lines.push(`- ${convo.name ?? convo.id} (${convo.messageCount} messages)`);
        }
        lines.push(``);
        lines.push(`> Use \`intentmesh_capture\` to extract intents from these conversations.`);
      }
    }

    return this.textResult(lines.join("\n"));
  }

  private formatCaptureResult(result: CaptureResult): McpToolResult {
    const lines: string[] = [];

    if (result.errors.length > 0) {
      lines.push(`### ❌ Capture Failed`);
      for (const error of result.errors) {
        lines.push(`- ${error}`);
      }
    } else {
      lines.push(`### ✅ Intents Captured`);
      lines.push(`- Intents imported: ${result.intentsImported}`);
      lines.push(`- Links created: ${result.linksCreated}`);
    }

    return this.textResult(lines.join("\n"));
  }

  private formatIntents(intents: IntentNode[]): McpToolResult {
    if (intents.length === 0) {
      return this.textResult("No intents found.");
    }

    const lines: string[] = [`## ${intents.length} Intent(s)`];
    
    for (const intent of intents) {
      lines.push(``);
      lines.push(`### ${intent.title}`);
      lines.push(`- ID: ${intent.id}`);
      lines.push(`- Statement: ${intent.statement}`);
      lines.push(`- Tags: ${intent.tags.join(", ")}`);
      lines.push(`- Status: ${intent.status}`);
    }

    return this.textResult(lines.join("\n"));
  }

  private formatDrifts(drifts: DriftEvent[]): McpToolResult {
    const open = drifts.filter(d => d.status === "open");
    
    if (open.length === 0) {
      return this.textResult("No active drift violations.");
    }

    const lines: string[] = [`## ${open.length} Active Drift(s)`];
    
    for (const drift of open) {
      lines.push(``);
      lines.push(`### ${drift.severity.toUpperCase()}: ${drift.summary}`);
      lines.push(`- ID: ${drift.id}`);
      lines.push(`- File: ${drift.fileUri}`);
      lines.push(`- Lines: ${drift.range.startLine}-${drift.range.endLine}`);
      lines.push(`- Explanation: ${drift.explanation}`);
      if (drift.suggestedFix) {
        lines.push(`- Suggested fix: ${drift.suggestedFix}`);
      }
    }

    return this.textResult(lines.join("\n"));
  }

  private textResult(text: string): McpToolResult {
    return { content: [{ type: "text", text }] };
  }

  private errorResult(message: string): McpToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/**
 * Factory function to create the MCP server with all dependencies
 */
export async function createMcpServer(
  workspaceRoot: string,
  deps: IntentMeshCoreDeps,
  log?: LogFn
): Promise<IntentMeshMcpServer> {
  const config: IntentMeshCoreConfig = {
    workspaceRoot,
    log,
  };

  const core = new IntentMeshCore(deps, config);
  await core.initialize();

  return new IntentMeshMcpServer(core, log);
}
