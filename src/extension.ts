import * as vscode from "vscode";
import * as path from "path";

// Core
import { IIntentStore } from "./core/store";
import { IAttributionSource } from "./core/attribution-source";
import { ILLMService } from "./core/llm-service";
import { IAnalysisEngine } from "./core/analysis-engine";

// Implementations
import { JsonFileStore } from "./storage/json-file-store";
import { AgentTraceFileSource } from "./sources/attribution/agent-trace-file";
import { LocalJsonChatSource } from "./sources/intent/local-json-chat";
import { LocalMarkdownChatSource } from "./sources/intent/local-markdown-chat";
import { LangChainLLMService } from "./llm/llm-service";
import { AnalysisEngine } from "./engine/analysis-engine";

// Services
import { IntentMeshService } from "./services/intent-mesh-service";

// UI
import { DiagnosticsManager } from "./ui/diagnostics";
import { IntentMeshHoverProvider } from "./ui/hover-provider";
import { IntentMeshTreeProvider } from "./ui/sidebar/tree-provider";

let intentMeshService: IntentMeshService;
let diagnosticsManager: DiagnosticsManager;
let outputChannel: vscode.OutputChannel;

function log(message: string, ...args: any[]): void {
  const msg = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message;
  outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("IntentMesh");
  outputChannel.show();
  log("IntentMesh extension activating...");

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("IntentMesh requires a workspace folder to be open.");
    return;
  }

  // Get configuration
  const config = vscode.workspace.getConfiguration("intentmesh");
  const llmProvider = config.get<string>("llmProvider", "openai");
  const llmModel = config.get<string>("llmModel", "gpt-5-mini");
  const openaiApiKey = config.get<string>("openaiApiKey", "");

  if (!openaiApiKey && llmProvider === "openai") {
    const action = await vscode.window.showWarningMessage(
      "IntentMesh requires an OpenAI API key. Please configure it in settings.",
      "Open Settings"
    );
    if (action === "Open Settings") {
      vscode.commands.executeCommand("workbench.action.openSettings", "intentmesh.openaiApiKey");
    }
  }

  // Initialize services
  const store: IIntentStore = new JsonFileStore(workspaceRoot);
  
  const attributionSource: IAttributionSource = new AgentTraceFileSource(
    workspaceRoot,
    config.get<string[]>("agentTracePaths", ["**/.agent-trace/**/*.json"])
  );

  // Langfuse config from environment or settings
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY || config.get<string>("langfusePublicKey", "");
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY || config.get<string>("langfuseSecretKey", "");
  const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL || config.get<string>("langfuseBaseUrl", "http://localhost:3000");

  const llmService = new LangChainLLMService({
    provider: llmProvider as "openai" | "anthropic" | "ollama",
    model: llmModel,
    apiKey: openaiApiKey,
    langfuse: langfusePublicKey && langfuseSecretKey ? {
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: langfuseBaseUrl,
    } : undefined,
  });

  if (langfusePublicKey && langfuseSecretKey) {
    log("Langfuse tracing enabled at:", langfuseBaseUrl);
  }

  const analysisEngine: IAnalysisEngine = new AnalysisEngine(store, attributionSource, llmService, log);

  intentMeshService = new IntentMeshService(
    store,
    attributionSource,
    llmService,
    analysisEngine,
    { workspaceRoot }
  );

  // Initialize
  await intentMeshService.initialize();

  // Set up UI
  diagnosticsManager = new DiagnosticsManager(intentMeshService);
  context.subscriptions.push(diagnosticsManager);

  // Register hover provider
  const hoverProvider = new IntentMeshHoverProvider(intentMeshService, store);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: "file" }, hoverProvider)
  );

  // Register tree view
  const treeProvider = new IntentMeshTreeProvider(intentMeshService);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("intentmesh.sidebar", treeProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.importConversation", async () => {
      await importConversationCommand(workspaceRoot, llmService);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.analyzeWorkspace", async () => {
      await analyzeWorkspaceCommand();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.refreshSidebar", () => {
      treeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.goToDrift", async (drift) => {
      if (drift?.fileUri && drift?.range) {
        const uri = vscode.Uri.parse(drift.fileUri.startsWith("file://") ? drift.fileUri : `file://${drift.fileUri}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const range = new vscode.Range(
          drift.range.startLine - 1,
          0,
          drift.range.endLine - 1,
          0
        );
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(range.start, range.end);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.showIntentDetails", async (intent) => {
      if (intent) {
        const panel = vscode.window.createWebviewPanel(
          "intentDetails",
          `Intent: ${intent.title}`,
          vscode.ViewColumn.Beside,
          {}
        );
        panel.webview.html = getIntentDetailsHtml(intent);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.dismissDrift", async (args) => {
      if (args?.eventId) {
        await intentMeshService.resolveDriftEvent(args.eventId, "acknowledged");
        treeProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.markFalsePositive", async (args) => {
      if (args?.eventId) {
        await intentMeshService.resolveDriftEvent(args.eventId, "false_positive");
        treeProvider.refresh();
      }
    })
  );

  // Listen for document saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      log("Document saved:", document.fileName);
      
      // Only analyze code files
      const supportedExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"];
      const ext = path.extname(document.fileName);
      if (!supportedExtensions.includes(ext)) {
        log("Skipping - unsupported extension:", ext);
        return;
      }

      // Check if there are intents linked to this file
      const fileUri = document.uri.toString();
      log("Checking links for:", fileUri);
      const links = await intentMeshService.getLinksForFile(fileUri);
      log("Found links:", links.length);
      
      if (links.length === 0) {
        log("No intents linked, skipping analysis");
        return; // No intents linked, skip analysis
      }

      log("Starting drift analysis with intents:", links.map(l => l.intentId));
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "IntentMesh: Analyzing for drift...",
          cancellable: false,
        },
        async () => {
          try {
            const events = await intentMeshService.analyzeOnSave(document);
            log("Analysis complete, drift events:", events.length);
            if (events.length > 0) {
              log("Drift events:", events.map(e => ({ summary: e.summary, severity: e.severity })));
            }
          } catch (error) {
            log("Analysis failed:", error instanceof Error ? error.message : String(error));
            log("Stack:", error instanceof Error ? error.stack : "no stack");
          }
        }
      );
    })
  );

  console.log("IntentMesh extension activated!");
  vscode.window.showInformationMessage("IntentMesh activated!");
}

async function importConversationCommand(workspaceRoot: string, llmService: ILLMService): Promise<void> {
  const options: vscode.OpenDialogOptions = {
    canSelectMany: false,
    openLabel: "Import Conversation",
    filters: {
      "Chat Files": ["json", "md", "txt"],
      "All Files": ["*"],
    },
  };

  const fileUri = await vscode.window.showOpenDialog(options);
  if (!fileUri || fileUri.length === 0) {
    return;
  }

  const filePath = fileUri[0].fsPath;
  const ext = path.extname(filePath).toLowerCase();

  let source;
  if (ext === ".json") {
    source = new LocalJsonChatSource(filePath, llmService);
  } else {
    source = new LocalMarkdownChatSource(filePath, llmService);
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "IntentMesh: Extracting intents...",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Parsing conversation..." });

      const result = await intentMeshService.importFromSource(source);

      if (result.errors.length > 0) {
        vscode.window.showErrorMessage(`Import failed: ${result.errors.join(", ")}`);
        return;
      }

      vscode.window.showInformationMessage(
        `Imported ${result.intentsImported} intents from conversation.`
      );
    }
  );
}

async function analyzeWorkspaceCommand(): Promise<void> {
  vscode.window.showInformationMessage("Workspace analysis coming soon!");
}

function getIntentDetailsHtml(intent: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; }
    h1 { color: var(--vscode-foreground); }
    .section { margin: 20px 0; }
    .label { font-weight: bold; color: var(--vscode-descriptionForeground); }
    .tags { margin-top: 10px; }
    .tag { 
      display: inline-block; 
      background: var(--vscode-badge-background); 
      color: var(--vscode-badge-foreground);
      padding: 2px 8px; 
      border-radius: 4px; 
      margin-right: 5px;
    }
    blockquote {
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding-left: 10px;
      margin-left: 0;
    }
  </style>
</head>
<body>
  <h1>${intent.title}</h1>
  
  <div class="section">
    <div class="label">Statement</div>
    <blockquote>${intent.statement}</blockquote>
  </div>
  
  <div class="section">
    <div class="label">Strength</div>
    <p>${intent.strength}</p>
  </div>
  
  <div class="section">
    <div class="label">Category</div>
    <p>${intent.category}</p>
  </div>
  
  <div class="section tags">
    <div class="label">Tags</div>
    <p>${intent.tags.map((t: string) => `<span class="tag">${t}</span>`).join("")}</p>
  </div>
  
  <div class="section">
    <div class="label">Status</div>
    <p>${intent.status}</p>
  </div>
</body>
</html>`;
}

export function deactivate(): void {
  console.log("IntentMesh extension deactivated");
}
