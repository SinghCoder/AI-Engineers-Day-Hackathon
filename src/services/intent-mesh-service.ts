import * as vscode from "vscode";
import { IIntentSource, RawIntent } from "../core/intent-source";
import { IAttributionSource } from "../core/attribution-source";
import { ILLMService } from "../core/llm-service";
import { IIntentStore } from "../core/store";
import { IAnalysisEngine, AnalysisResult } from "../core/analysis-engine";
import { IntentNode, createIntentNode, IntentLink } from "../models/intent";
import { DriftEvent } from "../models/drift";
import { IntentLinker } from "../engine/intent-linker";

export interface ImportResult {
  intentsImported: number;
  linksCreated: number;
  errors: string[];
}

export interface IntentMeshServiceConfig {
  workspaceRoot: string;
}

export class IntentMeshService implements vscode.Disposable {
  private readonly _onIntentsChanged = new vscode.EventEmitter<IntentNode[]>();
  readonly onIntentsChanged = this._onIntentsChanged.event;

  private readonly _onDriftDetected = new vscode.EventEmitter<DriftEvent[]>();
  readonly onDriftDetected = this._onDriftDetected.event;

  private readonly linker: IntentLinker;
  private initialized = false;

  constructor(
    private readonly store: IIntentStore,
    private readonly attributionSource: IAttributionSource,
    private readonly llmService: ILLMService,
    private readonly analysisEngine: IAnalysisEngine,
    private readonly config: IntentMeshServiceConfig
  ) {
    this.linker = new IntentLinker(store, attributionSource);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load storage
    await this.store.load();

    // Refresh attribution source
    if (await this.attributionSource.isAvailable()) {
      await this.attributionSource.refresh();
    }

    this.initialized = true;
  }

  dispose(): void {
    this._onIntentsChanged.dispose();
    this._onDriftDetected.dispose();
  }

  /**
   * Import intents from a source (e.g., conversation file)
   */
  async importFromSource(source: IIntentSource): Promise<ImportResult> {
    const errors: string[] = [];
    let intentsImported = 0;
    let linksCreated = 0;

    if (!(await source.isAvailable())) {
      return {
        intentsImported: 0,
        linksCreated: 0,
        errors: ["Source is not available"],
      };
    }

    try {
      // Extract raw intents from the source
      const rawIntents = await source.extractIntents();

      // Convert to IntentNodes and save
      for (const raw of rawIntents) {
        const intentNode = createIntentNode({
          title: raw.title,
          statement: raw.statement,
          tags: raw.suggestedTags,
          strength: raw.confidence === "high" ? "strong" : raw.confidence === "medium" ? "medium" : "weak",
          sources: [raw.sourceRef],
        });

        await this.store.saveIntent(intentNode);
        intentsImported++;

        // Try to auto-link based on conversation URL
        const links = await this.linker.linkIntentByConversation(intentNode);
        linksCreated += links.length;
      }

      // Notify listeners
      const allIntents = await this.store.getAllIntents();
      this._onIntentsChanged.fire(allIntents);

    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    return { intentsImported, linksCreated, errors };
  }

  /**
   * Import pre-extracted intents (from UI confirmation)
   */
  async importIntents(intents: Array<{
    title: string;
    statement: string;
    tags: string[];
    confidence: "high";
    evidence: string;
    sourceUri?: string;
  }>): Promise<ImportResult> {
    let intentsImported = 0;
    const errors: string[] = [];

    for (const intent of intents) {
      try {
        const intentNode = createIntentNode({
          title: intent.title,
          statement: intent.statement,
          tags: intent.tags,
          strength: "strong", // Only high-confidence intents now, so all are strong
          sources: [
            {
              sourceId: "import",
              sourceType: "conversation",
              uri: intent.sourceUri,
              timestamp: new Date(),
              metadata: { evidence: intent.evidence },
            },
          ],
        });

        await this.store.saveIntent(intentNode);
        intentsImported++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const allIntents = await this.store.getAllIntents();
    this._onIntentsChanged.fire(allIntents);

    return { intentsImported, linksCreated: 0, errors };
  }

  /**
   * Get all intents
   */
  async getAllIntents(): Promise<IntentNode[]> {
    return this.store.getAllIntents();
  }

  /**
   * Get intents that apply to a specific file
   */
  async getIntentsForFile(fileUri: string): Promise<IntentNode[]> {
    return this.linker.getIntentsForFile(fileUri);
  }

  /**
   * Get links for a file
   */
  async getLinksForFile(fileUri: string): Promise<IntentLink[]> {
    return this.store.getLinksForFile(fileUri);
  }

  /**
   * Manually link an intent to code
   */
  async linkIntentToCode(
    intentId: string,
    fileUri: string,
    startLine?: number,
    endLine?: number
  ): Promise<IntentLink> {
    return this.linker.createLink(intentId, fileUri, startLine, endLine);
  }

  /**
   * Analyze a document on save
   */
  async analyzeOnSave(document: vscode.TextDocument): Promise<DriftEvent[]> {
    const fileUri = document.uri.toString();
    
    const result = await this.analysisEngine.analyzeFile(fileUri);

    if (result.driftEvents.length > 0) {
      this._onDriftDetected.fire(result.driftEvents);
    }

    return result.driftEvents;
  }

  /**
   * Get all drift events
   */
  async getDriftEvents(fileUri?: string): Promise<DriftEvent[]> {
    return this.store.getDriftEvents(fileUri ? { fileUri } : {});
  }

  /**
   * Mark a drift event as acknowledged/resolved
   */
  async resolveDriftEvent(eventId: string, status: "acknowledged" | "resolved" | "false_positive"): Promise<void> {
    const events = await this.store.getDriftEvents({});
    const event = events.find((e) => e.id === eventId);
    
    if (event) {
      event.status = status;
      if (status === "resolved") {
        event.resolvedAt = new Date();
      }
      await this.store.saveDriftEvent(event);
    }
  }

  /**
   * Update an intent (e.g., when acknowledging drift as intentional)
   */
  async updateIntent(intentId: string, updates: Partial<IntentNode>): Promise<void> {
    const intent = await this.store.getIntent(intentId);
    if (intent) {
      const updated = { ...intent, ...updates, updatedAt: new Date() };
      await this.store.saveIntent(updated);
      
      const allIntents = await this.store.getAllIntents();
      this._onIntentsChanged.fire(allIntents);
    }
  }
}
