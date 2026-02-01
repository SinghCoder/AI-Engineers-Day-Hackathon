import * as vscode from "vscode";
import { DriftEvent } from "../models/drift";
import { IntentMeshService } from "../services/intent-mesh-service";

export class DiagnosticsManager implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly service: IntentMeshService) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("intentmesh");
    this.disposables.push(this.diagnosticCollection);

    // Listen for drift events
    this.disposables.push(
      service.onDriftDetected((events) => this.handleDriftEvents(events))
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Update diagnostics for a file based on drift events
   */
  updateForFile(fileUri: vscode.Uri, events: DriftEvent[]): void {
    const diagnostics = events.map((event) => this.eventToDiagnostic(event));
    this.diagnosticCollection.set(fileUri, diagnostics);
  }

  /**
   * Clear diagnostics for a file
   */
  clearForFile(fileUri: vscode.Uri): void {
    this.diagnosticCollection.delete(fileUri);
  }

  /**
   * Clear all diagnostics
   */
  clearAll(): void {
    this.diagnosticCollection.clear();
  }

  /**
   * Refresh all diagnostics from the store
   */
  async refresh(): Promise<void> {
    this.diagnosticCollection.clear();
    const events = await this.service.getDriftEvents();
    const openEvents = events.filter((e) => e.status === "open");
    this.handleDriftEvents(openEvents);
  }

  private handleDriftEvents(events: DriftEvent[]): void {
    // Group events by file
    const eventsByFile = new Map<string, DriftEvent[]>();
    
    for (const event of events) {
      const existing = eventsByFile.get(event.fileUri) ?? [];
      existing.push(event);
      eventsByFile.set(event.fileUri, existing);
    }

    // Update diagnostics for each file
    for (const [fileUri, fileEvents] of eventsByFile) {
      const uri = vscode.Uri.parse(fileUri.startsWith("file://") ? fileUri : `file://${fileUri}`);
      this.updateForFile(uri, fileEvents);
    }
  }

  private eventToDiagnostic(event: DriftEvent): vscode.Diagnostic {
    const range = new vscode.Range(
      event.range.startLine - 1,  // VS Code is 0-indexed
      event.range.startCharacter,
      event.range.endLine - 1,
      event.range.endCharacter || Number.MAX_VALUE
    );

    const severity = this.mapSeverity(event.severity);

    const diagnostic = new vscode.Diagnostic(range, event.summary, severity);
    diagnostic.source = "IntentMesh";
    diagnostic.code = event.id;

    // Add related information if we have attribution
    if (event.attribution?.conversationUrl) {
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            vscode.Uri.parse(event.attribution.conversationUrl),
            new vscode.Position(0, 0)
          ),
          `From conversation: ${event.attribution.conversationUrl}`
        ),
      ];
    }

    return diagnostic;
  }

  private mapSeverity(severity: "info" | "warning" | "error"): vscode.DiagnosticSeverity {
    switch (severity) {
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
        return vscode.DiagnosticSeverity.Information;
    }
  }
}
