import * as vscode from "vscode";
import * as path from "path";

// Core
import { IIntentStore } from "./core/store";
import { IAttributionSource } from "./core/attribution-source";
import { ILLMService, ConversationMessage } from "./core/llm-service";
import { IAnalysisEngine } from "./core/analysis-engine";

// Implementations
import { JsonFileStore } from "./storage/json-file-store";
import { AgentTraceFileSource } from "./sources/attribution/agent-trace-file";
import { LocalJsonChatSource } from "./sources/intent/local-json-chat";
import { LocalMarkdownChatSource } from "./sources/intent/local-markdown-chat";
import { CursorChatSource } from "./sources/intent/cursor-chat-source";
import { LangChainLLMService } from "./llm/llm-service";
import { AnalysisEngine } from "./engine/analysis-engine";

// Services
import { IntentMeshService } from "./services/intent-mesh-service";

// Core (new architecture)
import {
  IntentMeshCore,
  IntentMeshCoreDeps,
  NodeGitOperations,
  NodeFileReader,
  AgentTraceConversationLoader,
  CursorConversationProviderImpl,
} from "./core";

// UI
import { DiagnosticsManager } from "./ui/diagnostics";
import { IntentMeshHoverProvider } from "./ui/hover-provider";
import { IntentMeshTreeProvider } from "./ui/sidebar/tree-provider";

let intentMeshService: IntentMeshService;
let intentMeshCore: IntentMeshCore;
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

  // Initialize new core architecture with agent-trace support first
  const cursorProvider = new CursorConversationProviderImpl(log);
  const conversationLoader = new AgentTraceConversationLoader(
    workspaceRoot,
    cursorProvider,
    log
  );

  const analysisEngine: IAnalysisEngine = new AnalysisEngine(
    store,
    attributionSource,
    llmService,
    log,
    conversationLoader
  );

  intentMeshService = new IntentMeshService(
    store,
    attributionSource,
    llmService,
    analysisEngine,
    { workspaceRoot, conversationLoader }
  );

  // Initialize legacy service
  await intentMeshService.initialize();

  // Set up core service
  const coreDeps: IntentMeshCoreDeps = {
    store,
    attributionSource,
    llmService,
    analysisEngine,
    git: new NodeGitOperations(workspaceRoot),
    fileReader: new NodeFileReader(),
    conversationLoader,
  };

  intentMeshCore = new IntentMeshCore(coreDeps, { workspaceRoot, log });
  await intentMeshCore.initialize();
  context.subscriptions.push(intentMeshCore);

  // Set up UI
  diagnosticsManager = new DiagnosticsManager(intentMeshService);
  context.subscriptions.push(diagnosticsManager);
  
  // Load existing drift diagnostics on startup
  await diagnosticsManager.refresh();

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
    vscode.commands.registerCommand("intentmesh.importFromCursor", async () => {
      await importFromCursorCommand(workspaceRoot, llmService, treeProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.refreshSidebar", async () => {
      // Reload from disk first, then refresh tree and diagnostics
      await store.load();
      await treeProvider.refresh();
      await diagnosticsManager.refresh();
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
        diagnosticsManager.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.markFalsePositive", async (args) => {
      if (args?.eventId) {
        await intentMeshService.resolveDriftEvent(args.eventId, "false_positive");
        treeProvider.refresh();
        diagnosticsManager.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.updateIntent", async (args) => {
      if (args?.eventId) {
        // Get the drift event to find related intent
        const events = await intentMeshService.getDriftEvents();
        const event = events.find((e) => e.id === args.eventId);
        
        if (event && event.intentIds.length > 0) {
          const intent = await store.getIntent(event.intentIds[0]);
          if (intent) {
            const newStatement = await vscode.window.showInputBox({
              prompt: "Update intent statement to reflect current implementation",
              value: intent.statement,
              placeHolder: "Enter updated intent statement..."
            });
            
            if (newStatement && newStatement !== intent.statement) {
              await intentMeshService.updateIntent(intent.id, { statement: newStatement });
              await intentMeshService.resolveDriftEvent(args.eventId, "resolved");
              treeProvider.refresh();
              diagnosticsManager.refresh();
              vscode.window.showInformationMessage(`Intent "${intent.title}" updated.`);
            }
          }
        }
      }
    })
  );

  // Command: Analyze current file for drift
  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.analyzeCurrentFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active file to analyze.");
        return;
      }

      const document = editor.document;
      const fileUri = document.uri.toString();
      
      const links = await intentMeshService.getLinksForFile(fileUri);
      if (links.length === 0) {
        vscode.window.showInformationMessage("No intents linked to this file.");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "IntentMesh: Analyzing for drift...",
          cancellable: false,
        },
        async () => {
          const events = await intentMeshService.analyzeOnSave(document);
          if (events.length > 0) {
            vscode.window.showWarningMessage(`Found ${events.length} drift violation(s).`);
          } else {
            vscode.window.showInformationMessage("No drift detected.");
          }
          treeProvider.refresh();
          diagnosticsManager.refresh();
        }
      );
    })
  );

  // Command: Analyze all linked files (for pre-commit hook)
  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.analyzeAllLinked", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "IntentMesh: Analyzing all linked files...",
          cancellable: false,
        },
        async (progress) => {
          const allIntents = await intentMeshService.getAllIntents();
          const allLinks = new Set<string>();
          
          for (const intent of allIntents) {
            const links = await store.getLinksForIntent(intent.id);
            links.forEach(l => allLinks.add(l.fileUri));
          }

          let totalDrifts = 0;
          const files = Array.from(allLinks);
          
          for (let i = 0; i < files.length; i++) {
            progress.report({ 
              message: `Checking ${i + 1}/${files.length}...`,
              increment: (100 / files.length)
            });
            
            try {
              const uri = vscode.Uri.parse(files[i]);
              const doc = await vscode.workspace.openTextDocument(uri);
              const events = await intentMeshService.analyzeOnSave(doc);
              totalDrifts += events.length;
            } catch (error) {
              log("Failed to analyze:", files[i], error);
            }
          }

          treeProvider.refresh();
          diagnosticsManager.refresh();
          
          if (totalDrifts > 0) {
            vscode.window.showWarningMessage(
              `Found ${totalDrifts} drift violation(s) across ${files.length} files.`
            );
          } else {
            vscode.window.showInformationMessage(
              `No drift detected in ${files.length} linked files.`
            );
          }
        }
      );
    })
  );

  // NEW COMMAND: Analyze Changes (uses agent-trace for auto-linking)
  context.subscriptions.push(
    vscode.commands.registerCommand("intentmesh.analyzeChanges", async () => {
      await analyzeChangesCommand(workspaceRoot, treeProvider, diagnosticsManager);
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

/**
 * NEW: Analyze Changes command
 * Uses agent-trace to automatically find conversations and link intents
 */
async function analyzeChangesCommand(
  workspaceRoot: string,
  treeProvider: IntentMeshTreeProvider,
  diagnosticsManager: DiagnosticsManager
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "IntentMesh: Analyzing changes...",
      cancellable: true,
    },
    async (progress, token) => {
      // Step 1: Get changed files (fast)
      progress.report({ message: "Getting changed files..." });
      const state = await intentMeshCore.getState();
      const files = await (intentMeshCore as any).deps.git.getChangedFiles();

      if (files.length === 0) {
        vscode.window.showInformationMessage("No changes detected in workspace.");
        return;
      }

      // Check for cancellation
      if (token.isCancellationRequested) {
        vscode.window.showInformationMessage("Analysis cancelled.");
        return;
      }

      // Step 2: Check for drift (slow - LLM calls)
      progress.report({ message: `Checking ${files.length} file(s) for drift...` });
      const driftResult = await intentMeshCore.detectDrift(files);

      if (token.isCancellationRequested) {
        vscode.window.showInformationMessage("Analysis cancelled.");
        return;
      }

      progress.report({ message: `Checked ${files.length} files, finding conversations...` });

      // Step 3: Load conversations if no drifts
      let pendingConversations: { id: string; name?: string; messageCount: number }[] = [];
      if (driftResult.drifts.length === 0) {
        const convos = await (intentMeshCore as any).deps.conversationLoader?.loadConversationsForFiles(files) ?? [];
        pendingConversations = convos.map((c: any) => ({
          id: c.id,
          name: c.name,
          messageCount: c.messages.length,
        }));
      }

      const result = {
        drifts: driftResult.drifts,
        filesAnalyzed: driftResult.filesAnalyzed,
        intentsChecked: driftResult.intentsChecked,
        canCapture: driftResult.drifts.length === 0,
        pendingConversations,
      };

      progress.report({ message: `Checked ${result.filesAnalyzed} files...` });

      // Check for cancellation
      if (token.isCancellationRequested) {
        vscode.window.showInformationMessage("Analysis cancelled.");
        return;
      }

      // Step 2: Handle drifts
      if (result.drifts.length > 0) {
        treeProvider.refresh();
        diagnosticsManager.refresh();

        const action = await vscode.window.showWarningMessage(
          `Found ${result.drifts.length} drift violation(s). Fix them before capturing new intents.`,
          "Show Drifts",
          "Dismiss All"
        );

        if (action === "Dismiss All") {
          for (const drift of result.drifts) {
            await intentMeshCore.resolveDrift(drift.id, "dismiss");
          }
          treeProvider.refresh();
          diagnosticsManager.refresh();
          vscode.window.showInformationMessage("All drifts dismissed. Run again to capture intents.");
        }
        return;
      }

      // Step 3: No drifts - offer to capture intents
      if (result.canCapture && result.pendingConversations && result.pendingConversations.length > 0) {
        progress.report({ message: "Finding AI conversations..." });

        const convoItems = result.pendingConversations.map(c => ({
          label: c.name ?? `Conversation ${c.id.slice(0, 8)}`,
          description: `${c.messageCount} messages`,
          picked: true,
          id: c.id,
        }));

        const selected = await vscode.window.showQuickPick(convoItems, {
          canPickMany: true,
          title: "Capture intents from these AI conversations?",
          placeHolder: "Select conversations to extract intents from...",
        });

        if (selected && selected.length > 0) {
          // Check for cancellation before LLM call
          if (token.isCancellationRequested) {
            vscode.window.showInformationMessage("Analysis cancelled.");
            return;
          }

          progress.report({ message: "Extracting intents..." });

          const captureResult = await intentMeshCore.captureIntents({
            conversationIds: selected.map(s => s.id),
            autoLink: true,
          });

          treeProvider.refresh();

          if (captureResult.errors.length > 0) {
            vscode.window.showErrorMessage(`Errors: ${captureResult.errors.join(", ")}`);
          } else {
            vscode.window.showInformationMessage(
              `Captured ${captureResult.intentsImported} intents with ${captureResult.linksCreated} auto-links.`
            );
          }
        }
      } else {
        vscode.window.showInformationMessage(
          `No drift detected. ${result.intentsChecked} intents checked across ${result.filesAnalyzed} files.`
        );
      }
    }
  );
}

async function importFromCursorCommand(
  workspaceRoot: string, 
  llmService: ILLMService,
  treeProvider: IntentMeshTreeProvider
): Promise<void> {
  const cursorSource = new CursorChatSource(llmService, workspaceRoot, log);

  if (!(await cursorSource.isAvailable())) {
    vscode.window.showErrorMessage("Cursor data directory not found.");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "IntentMesh: Scanning Cursor chats...",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Finding conversations..." });

      // Get ALL sessions, not just filtered ones
      const allSessions = await cursorSource.extractSessions();
      log("Found total Cursor sessions:", allSessions.length);

      if (allSessions.length === 0) {
        vscode.window.showWarningMessage("No Cursor conversations found.");
        return;
      }

      // Pre-select sessions that match current workspace by path
      const normalizedWorkspace = workspaceRoot.toLowerCase();
      const workspaceBasename = path.basename(workspaceRoot).toLowerCase();
      
      log("Current workspace:", workspaceRoot, "basename:", workspaceBasename);
      
      // Build items for quick pick
      interface SessionPickItem extends vscode.QuickPickItem {
        session: { composerId: string; messages: ConversationMessage[] };
      }
      
      const items: SessionPickItem[] = allSessions
        .filter(s => s.messages.length >= 2) // At least one exchange
        .map(s => {
          // Match if the project path matches the workspace
          const normalizedProject = (s.projectPath || "").toLowerCase();
          const projectBasename = s.projectPath ? path.basename(s.projectPath).toLowerCase() : "";
          
          // Multi-level matching:
          // 1. Exact substring match
          // 2. Same basename
          // 3. If projectPath is empty, less strict matching
          const matchesWorkspace = 
            (normalizedProject.length > 0 && 
              (normalizedWorkspace.includes(normalizedProject) || 
               normalizedProject.includes(normalizedWorkspace))) ||
            (projectBasename && projectBasename === workspaceBasename) ||
            (projectBasename && normalizedWorkspace.includes(projectBasename));
          
          log(`Session "${s.name}": projectPath="${s.projectPath}", matches=${matchesWorkspace}`);
          
          return {
            label: s.name || `Session ${s.composerId.slice(0, 8)}`,
            description: `${s.messages.length} messages${matchesWorkspace ? " ★ this workspace" : ""}`,
            detail: s.projectPath || "(project path unknown)",
            session: { composerId: s.composerId, messages: s.messages },
            picked: matchesWorkspace || undefined,
          } as SessionPickItem;
        });

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: "Select Cursor conversations to extract intents from",
        placeHolder: "Pick conversations...",
      });

      if (!selected || selected.length === 0) {
        return;
      }

      progress.report({ message: "Extracting intents with LLM..." });

      let totalIntents = 0;

      for (const item of selected) {
        try {
          const extracted = await llmService.extractIntents(item.session.messages);
          
          const result = await intentMeshService.importIntents(
            extracted.map(intent => ({
              title: intent.title,
              statement: intent.statement,
              tags: intent.tags,
              confidence: intent.confidence,
              evidence: intent.evidence,
              sourceUri: `cursor://composer/${item.session.composerId}`,
            }))
          );

          totalIntents += result.intentsImported;
        } catch (error) {
          log("Failed to extract from session:", item.session.composerId, error);
        }
      }

      treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Imported ${totalIntents} intents from ${selected.length} Cursor conversations.`
      );
    }
  );
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
