#!/usr/bin/env node
/**
 * MCP stdio entrypoint for IntentMesh
 * Run with: node out/mcp-stdio.js /path/to/workspace
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { IntentMeshCore, IntentMeshCoreDeps } from "./core/intent-mesh-core";
import { IntentMeshMcpServer } from "./adapters/mcp/mcp-server";
import { NodeGitOperations } from "./core/implementations/git-operations";
import { NodeFileReader } from "./core/implementations/file-reader";
import { AgentTraceConversationLoader } from "./core/implementations/agent-trace-loader";
import { CursorConversationProviderImpl } from "./core/implementations/cursor-conversation-provider";
import { JsonFileStore } from "./storage/json-file-store";
import { AgentTraceFileSource } from "./sources/attribution/agent-trace-file";
import { LangChainLLMService } from "./llm/llm-service";
import { AnalysisEngine } from "./engine/analysis-engine";

const log = (msg: string, ...args: any[]) => {
  console.error(`[IntentMesh MCP] ${msg}`, ...args);
};

async function main() {
  const workspaceRoot = process.argv[2] || process.cwd();
  log("Starting MCP server for workspace:", workspaceRoot);

  // Initialize dependencies
  const store = new JsonFileStore(workspaceRoot);
  const attributionSource = new AgentTraceFileSource(workspaceRoot, ["**/.agent-trace/**/*.json"]);
  
  const llmService = new LangChainLLMService({
    provider: "openai",
    model: process.env.INTENTMESH_MODEL || "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || "",
  });

  const analysisEngine = new AnalysisEngine(store, attributionSource, llmService, log);
  
  const cursorProvider = new CursorConversationProviderImpl(log);
  const conversationLoader = new AgentTraceConversationLoader(workspaceRoot, cursorProvider, log);

  const deps: IntentMeshCoreDeps = {
    store,
    attributionSource,
    llmService,
    analysisEngine,
    git: new NodeGitOperations(workspaceRoot),
    fileReader: new NodeFileReader(),
    conversationLoader,
  };

  const core = new IntentMeshCore(deps, { workspaceRoot, log });
  await core.initialize();

  const intentMesh = new IntentMeshMcpServer(core, log);

  // Create MCP server
  const server = new Server(
    { name: "intentmesh", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = intentMesh.getTools();
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await intentMesh.handleToolCall(name, args as Record<string, unknown>);
    return result;
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await intentMesh.getResources();
    return { resources };
  });

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const content = await intentMesh.readResource(request.params.uri);
    return {
      contents: [{ uri: request.params.uri, mimeType: "application/json", text: content }],
    };
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
