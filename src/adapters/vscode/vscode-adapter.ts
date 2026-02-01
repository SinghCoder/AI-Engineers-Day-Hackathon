/**
 * VS Code Adapter - wraps IntentMeshCore for VS Code extension
 */

import * as vscode from "vscode";
import {
  IntentMeshCore,
  IntentMeshCoreConfig,
  IntentMeshCoreDeps,
  IntentMeshEvent,
  AnalyzeResult,
  CaptureResult,
} from "../../core/intent-mesh-core";
import { IntentNode, IntentLink } from "../../models/intent";
import { DriftEvent } from "../../models/drift";
import { LogFn } from "../../core/types";

export class VsCodeIntentMeshAdapter implements vscode.Disposable {
  private readonly _onIntentsChanged = new vscode.EventEmitter<IntentNode[]>();
  readonly onIntentsChanged = this._onIntentsChanged.event;

  private readonly _onDriftDetected = new vscode.EventEmitter<DriftEvent[]>();
  readonly onDriftDetected = this._onDriftDetected.event;

  private readonly _onAnalysisComplete = new vscode.EventEmitter<AnalyzeResult>();
  readonly onAnalysisComplete = this._onAnalysisComplete.event;

  private disposables: vscode.Disposable[] = [];

  constructor(private readonly core: IntentMeshCore) {
    // Bridge core events to VS Code events
    const eventSub = core.onEvent((event) => this.handleCoreEvent(event));
    this.disposables.push({ dispose: () => eventSub.dispose() });
  }

  private handleCoreEvent(event: IntentMeshEvent): void {
    switch (event.type) {
      case "intents_changed":
        this._onIntentsChanged.fire(event.intents);
        break;
      case "drifts_detected":
        this._onDriftDetected.fire(event.drifts);
        break;
      case "analysis_complete":
        this._onAnalysisComplete.fire(event.result);
        break;
    }
  }

  dispose(): void {
    this._onIntentsChanged.dispose();
    this._onDriftDetected.dispose();
    this._onAnalysisComplete.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  // ============ Core Methods (delegated) ============

  async initialize(): Promise<void> {
    return this.core.initialize();
  }

  async analyzeChanges(options?: { since?: string; files?: string[] }): Promise<AnalyzeResult> {
    return this.core.analyzeChanges(options);
  }

  async captureIntents(options?: { conversationIds?: string[]; autoLink?: boolean }): Promise<CaptureResult> {
    return this.core.captureIntents(options);
  }

  async getIntents(): Promise<IntentNode[]> {
    return this.core.getIntents();
  }

  async getDrifts(fileUri?: string): Promise<DriftEvent[]> {
    return this.core.getDrifts(fileUri);
  }

  async getLinksForFile(fileUri: string): Promise<IntentLink[]> {
    return this.core.getLinksForFile(fileUri);
  }

  async resolveDrift(
    eventId: string,
    action: "dismiss" | "false_positive" | "update_intent",
    newStatement?: string
  ): Promise<void> {
    return this.core.resolveDrift(eventId, action, newStatement);
  }

  async updateIntent(intentId: string, updates: Partial<IntentNode>): Promise<void> {
    return this.core.updateIntent(intentId, updates);
  }

  async linkIntentToCode(
    intentId: string,
    fileUri: string,
    startLine?: number,
    endLine?: number
  ): Promise<IntentLink> {
    return this.core.linkIntentToFile(intentId, fileUri, startLine, endLine);
  }

  // ============ VS Code Specific Methods ============

  /**
   * Analyze the current document for drift
   */
  async analyzeDocument(document: vscode.TextDocument): Promise<DriftEvent[]> {
    const fileUri = document.uri.fsPath;
    const result = await this.core.detectDrift([fileUri]);
    
    if (result.drifts.length > 0) {
      this._onDriftDetected.fire(result.drifts);
    }

    return result.drifts;
  }

  /**
   * Get intents that apply to the current document
   */
  async getIntentsForDocument(document: vscode.TextDocument): Promise<IntentNode[]> {
    const fileUri = document.uri.toString();
    const links = await this.core.getLinksForFile(fileUri);
    const intentIds = [...new Set(links.map(l => l.intentId))];
    
    const allIntents = await this.core.getIntents();
    return allIntents.filter(i => intentIds.includes(i.id) && i.status === "active");
  }
}

/**
 * Factory function to create the VS Code adapter with all dependencies
 */
export async function createVsCodeAdapter(
  workspaceRoot: string,
  deps: IntentMeshCoreDeps,
  log?: LogFn
): Promise<VsCodeIntentMeshAdapter> {
  const config: IntentMeshCoreConfig = {
    workspaceRoot,
    log,
  };

  const core = new IntentMeshCore(deps, config);
  await core.initialize();

  return new VsCodeIntentMeshAdapter(core);
}
