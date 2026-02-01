/**
 * Core IntentMesh service - no vscode dependencies
 * Can be used by VS Code extension, MCP server, CLI, etc.
 */

import { IIntentSource } from "./intent-source";
import { IAttributionSource } from "./attribution-source";
import { ILLMService, ConversationMessage, ExtractedIntent } from "./llm-service";
import { IIntentStore } from "./store";
import { IAnalysisEngine } from "./analysis-engine";
import { IntentNode, createIntentNode, IntentLink } from "../models/intent";
import { DriftEvent } from "../models/drift";
import { Disposable, LogFn, GitOperations, FileReader } from "./types";

// ============ Result Types ============

export interface AnalyzeResult {
  drifts: DriftEvent[];
  canCapture: boolean;
  pendingConversations?: ConversationSummary[];
  filesAnalyzed: number;
  intentsChecked: number;
}

export interface ConversationSummary {
  id: string;
  name?: string;
  messageCount: number;
  projectPath?: string;
}

export interface CaptureResult {
  intentsImported: number;
  linksCreated: number;
  errors: string[];
}

export interface StateSnapshot {
  intents: IntentNode[];
  drifts: DriftEvent[];
  links: IntentLink[];
}

// ============ Event Types ============

export type IntentMeshEvent =
  | { type: "intents_changed"; intents: IntentNode[] }
  | { type: "drifts_detected"; drifts: DriftEvent[] }
  | { type: "analysis_complete"; result: AnalyzeResult };

export type EventListener = (event: IntentMeshEvent) => void;

// ============ Configuration ============

export interface IntentMeshCoreConfig {
  workspaceRoot: string;
  log?: LogFn;
}

// ============ Dependencies ============

export interface IntentMeshCoreDeps {
  store: IIntentStore;
  attributionSource: IAttributionSource;
  llmService: ILLMService;
  analysisEngine: IAnalysisEngine;
  git: GitOperations;
  fileReader: FileReader;
  conversationLoader?: ConversationLoader;
}

export interface ConversationLoader {
  loadConversationsForFiles(files: string[]): Promise<LoadedConversation[]>;
  loadConversationById(id: string): Promise<LoadedConversation | null>;
}

export interface LoadedConversation {
  id: string;
  name?: string;
  messages: ConversationMessage[];
  projectPath?: string;
  fileRanges?: Array<{ filePath: string; startLine: number; endLine: number }>;
}

// ============ Core Service ============

export class IntentMeshCore implements Disposable {
  private listeners: Set<EventListener> = new Set();
  private initialized = false;
  private log: LogFn;

  constructor(
    private readonly deps: IntentMeshCoreDeps,
    private readonly config: IntentMeshCoreConfig
  ) {
    this.log = config.log ?? console.log;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.deps.store.load();

    if (await this.deps.attributionSource.isAvailable()) {
      await this.deps.attributionSource.refresh();
    }

    this.initialized = true;
  }

  dispose(): void {
    this.listeners.clear();
  }

  // ============ Event Handling ============

  onEvent(listener: EventListener): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(event: IntentMeshEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        this.log("Event listener error:", e);
      }
    }
  }

  // ============ Main Workflow ============

  /**
   * Main command: Analyze changes in the workspace
   * 1. Get changed files (from git diff)
   * 2. Detect drift against existing intents
   * 3. If no drifts, offer to capture new intents from AI conversations
   */
  async analyzeChanges(options?: {
    since?: string;
    files?: string[];
  }): Promise<AnalyzeResult> {
    const files = options?.files ?? await this.deps.git.getChangedFiles({ since: options?.since });
    
    if (files.length === 0) {
      return {
        drifts: [],
        canCapture: true,
        filesAnalyzed: 0,
        intentsChecked: 0,
      };
    }

    // Step 1: Detect drift against existing intents
    const driftResult = await this.detectDrift(files);
    
    // Step 2: If no drifts, find pending conversations for capture
    let pendingConversations: ConversationSummary[] | undefined;
    const canCapture = driftResult.drifts.length === 0;
    
    if (canCapture && this.deps.conversationLoader) {
      const convos = await this.deps.conversationLoader.loadConversationsForFiles(files);
      pendingConversations = convos.map(c => ({
        id: c.id,
        name: c.name,
        messageCount: c.messages.length,
        projectPath: c.projectPath,
      }));
    }

    const result: AnalyzeResult = {
      drifts: driftResult.drifts,
      canCapture,
      pendingConversations,
      filesAnalyzed: driftResult.filesAnalyzed,
      intentsChecked: driftResult.intentsChecked,
    };

    this.emit({ type: "analysis_complete", result });
    
    if (driftResult.drifts.length > 0) {
      this.emit({ type: "drifts_detected", drifts: driftResult.drifts });
    }

    return result;
  }

  /**
   * Detect drift in specified files against existing intents
   * Uses git diffs for efficiency (only checks changed code)
   * Processes files in parallel batches for speed
   */
  async detectDrift(files: string[], batchSize = 5): Promise<{
    drifts: DriftEvent[];
    filesAnalyzed: number;
    intentsChecked: number;
  }> {
    const allDrifts: DriftEvent[] = [];
    let totalIntentsChecked = 0;

    // Process files in batches for parallel execution
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      // Process batch in parallel
      const results = await Promise.all(
        batch.map(async (file) => {
          const fileUri = file.startsWith("file://") ? file : `file://${file}`;
          const filePath = file.replace(/^file:\/\//, "");
          
          // Get diff for this file (more efficient than sending whole file)
          const diff = await this.deps.git.getFileDiff(filePath);
          
          return this.deps.analysisEngine.analyzeFile(fileUri, { diff });
        })
      );

      // Collect results
      for (const result of results) {
        allDrifts.push(...result.driftEvents);
        totalIntentsChecked += result.intentsChecked;
      }
    }

    return {
      drifts: allDrifts,
      filesAnalyzed: files.length,
      intentsChecked: totalIntentsChecked,
    };
  }

  /**
   * Capture intents from AI conversations
   * Only allowed when there are no unresolved drifts
   */
  async captureIntents(options?: {
    conversationIds?: string[];
    autoLink?: boolean;
  }): Promise<CaptureResult> {
    // Check for unresolved drifts
    const openDrifts = await this.deps.store.getDriftEvents({ status: "open" });
    if (openDrifts.length > 0) {
      return {
        intentsImported: 0,
        linksCreated: 0,
        errors: [`Cannot capture intents: ${openDrifts.length} unresolved drift(s). Fix or dismiss them first.`],
      };
    }

    if (!this.deps.conversationLoader) {
      return {
        intentsImported: 0,
        linksCreated: 0,
        errors: ["No conversation loader configured"],
      };
    }

    const errors: string[] = [];
    let intentsImported = 0;
    let linksCreated = 0;

    // Load conversations - always use loadConversationsForFiles to get fileRanges from trace
    const files = await this.deps.git.getChangedFiles();
    const allConvos = await this.deps.conversationLoader.loadConversationsForFiles(files);
    
    // Filter by conversationIds if specified
    const conversations = options?.conversationIds
      ? allConvos.filter(c => options.conversationIds!.includes(c.id))
      : allConvos;

    // Extract intents from each conversation
    for (const convo of conversations) {
      try {
        const extracted = await this.deps.llmService.extractIntents(convo.messages);
        
        for (const intent of extracted) {
          const intentNode = createIntentNode({
            title: intent.title,
            statement: intent.statement,
            tags: intent.tags,
            strength: "strong",
            sources: [{
              sourceId: convo.id,
              sourceType: "conversation",
              uri: `conversation://${convo.id}`,
              timestamp: new Date(),
              metadata: { evidence: intent.evidence },
            }],
          });

          await this.deps.store.saveIntent(intentNode);
          intentsImported++;

          // Auto-link if file ranges are available
          if (options?.autoLink && convo.fileRanges) {
            for (const range of convo.fileRanges) {
              const link = {
                id: crypto.randomUUID(),
                intentId: intentNode.id,
                fileUri: range.filePath,
                startLine: range.startLine,
                endLine: range.endLine,
                linkType: "extracted" as const,
                confidence: 0.9,
                createdAt: new Date(),
                createdBy: "system" as const,
              };
              await this.deps.store.saveLink(link);
              linksCreated++;
            }
          }
        }
      } catch (error) {
        errors.push(`Failed to extract from ${convo.id}: ${error}`);
      }
    }

    // Notify listeners
    const allIntents = await this.deps.store.getAllIntents();
    this.emit({ type: "intents_changed", intents: allIntents });

    return { intentsImported, linksCreated, errors };
  }

  // ============ State Management ============

  async getState(): Promise<StateSnapshot> {
    const intents = await this.deps.store.getAllIntents();
    const drifts = await this.deps.store.getDriftEvents({});
    
    // Collect all links
    const links: IntentLink[] = [];
    for (const intent of intents) {
      const intentLinks = await this.deps.store.getLinksForIntent(intent.id);
      links.push(...intentLinks);
    }

    return { intents, drifts, links };
  }

  async getIntents(): Promise<IntentNode[]> {
    return this.deps.store.getAllIntents();
  }

  async getDrifts(fileUri?: string): Promise<DriftEvent[]> {
    return this.deps.store.getDriftEvents(fileUri ? { fileUri } : {});
  }

  async getLinksForFile(fileUri: string): Promise<IntentLink[]> {
    return this.deps.store.getLinksForFile(fileUri);
  }

  // ============ Drift Resolution ============

  async resolveDrift(
    eventId: string,
    action: "dismiss" | "false_positive" | "update_intent",
    newStatement?: string
  ): Promise<void> {
    const events = await this.deps.store.getDriftEvents({});
    const event = events.find(e => e.id === eventId);
    
    if (!event) {
      throw new Error(`Drift event ${eventId} not found`);
    }

    switch (action) {
      case "dismiss":
        event.status = "acknowledged";
        await this.deps.store.saveDriftEvent(event);
        break;
        
      case "false_positive":
        event.status = "false_positive";
        await this.deps.store.saveDriftEvent(event);
        break;
        
      case "update_intent":
        if (!newStatement) {
          throw new Error("newStatement required for update_intent action");
        }
        // Update the intent and resolve drift
        if (event.intentIds.length > 0) {
          const intent = await this.deps.store.getIntent(event.intentIds[0]);
          if (intent) {
            intent.statement = newStatement;
            intent.updatedAt = new Date();
            await this.deps.store.saveIntent(intent);
          }
        }
        event.status = "resolved";
        event.resolvedAt = new Date();
        await this.deps.store.saveDriftEvent(event);
        break;
    }
  }

  // ============ Intent Management ============

  async updateIntent(intentId: string, updates: Partial<IntentNode>): Promise<void> {
    const intent = await this.deps.store.getIntent(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    const updated = { ...intent, ...updates, updatedAt: new Date() };
    await this.deps.store.saveIntent(updated);

    const allIntents = await this.deps.store.getAllIntents();
    this.emit({ type: "intents_changed", intents: allIntents });
  }

  async deleteIntent(intentId: string): Promise<void> {
    await this.deps.store.deleteIntent(intentId);
    
    const allIntents = await this.deps.store.getAllIntents();
    this.emit({ type: "intents_changed", intents: allIntents });
  }

  async linkIntentToFile(
    intentId: string,
    fileUri: string,
    startLine?: number,
    endLine?: number
  ): Promise<IntentLink> {
    const link: IntentLink = {
      id: crypto.randomUUID(),
      intentId,
      fileUri,
      startLine,
      endLine,
      linkType: "manual",
      confidence: 1.0,
      createdAt: new Date(),
      createdBy: "user",
    };

    await this.deps.store.saveLink(link);
    return link;
  }
}
