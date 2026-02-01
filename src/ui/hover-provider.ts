import * as vscode from "vscode";
import { IntentMeshService } from "../services/intent-mesh-service";
import { IIntentStore } from "../core/store";

export class IntentMeshHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly service: IntentMeshService,
    private readonly store: IIntentStore
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const fileUri = document.uri.toString();
    const line = position.line + 1; // Convert to 1-indexed

    // Get drift events for this file
    const events = await this.service.getDriftEvents(fileUri);

    // Find events that cover this position
    const relevantEvents = events.filter(
      (e) => e.range.startLine <= line && e.range.endLine >= line && e.status === "open"
    );

    if (relevantEvents.length === 0) {
      return null;
    }

    // Build hover content
    const contents = new vscode.MarkdownString();
    contents.isTrusted = true;
    contents.supportHtml = true;
    contents.supportThemeIcons = true;

    for (const event of relevantEvents) {
      // Get the related intent
      const intentIds = event.intentIds;
      const intents = await Promise.all(
        intentIds.map((id) => this.store.getIntent(id))
      );

      const severityIcon = event.severity === "error" ? "🔴" : event.severity === "warning" ? "🟡" : "🔵";

      contents.appendMarkdown(`### ${severityIcon} Intent Violation\n\n`);
      contents.appendMarkdown(`**${event.summary}**\n\n`);
      contents.appendMarkdown(`${event.explanation}\n\n`);

      // Show related intents
      for (const intent of intents) {
        if (intent) {
          contents.appendMarkdown(`---\n`);
          contents.appendMarkdown(`**📋 Intent:** ${intent.title}\n\n`);
          contents.appendMarkdown(`> ${intent.statement}\n\n`);
          
          // Show evidence if available
          const evidence = intent.sources[0]?.metadata?.evidence;
          if (evidence) {
            contents.appendMarkdown(`**📝 Evidence:** "${evidence}"\n\n`);
          }
        }
      }

      // Show attribution if available
      if (event.attribution) {
        if (event.attribution.contributor.modelId) {
          contents.appendMarkdown(`**🤖 Written by:** ${event.attribution.contributor.modelId}`);
          if (event.attribution.contributor.toolId) {
            contents.appendMarkdown(` (${event.attribution.contributor.toolId})`);
          }
          contents.appendMarkdown(`\n\n`);
        }

        if (event.attribution.conversationUrl) {
          contents.appendMarkdown(`**💬 Conversation:** [Open thread ↗](${event.attribution.conversationUrl})\n\n`);
        }
      }

      // Show suggested fix if available
      if (event.suggestedFix) {
        contents.appendMarkdown(`---\n`);
        contents.appendMarkdown(`**💡 Suggestion:** ${event.suggestedFix}\n\n`);
      }

      // Add action buttons
      contents.appendMarkdown(`---\n`);
      const updateCmd = `command:intentmesh.updateIntent?${encodeURIComponent(JSON.stringify({ eventId: event.id }))}`;
      const dismissCmd = `command:intentmesh.dismissDrift?${encodeURIComponent(JSON.stringify({ eventId: event.id }))}`;
      const falsePositiveCmd = `command:intentmesh.markFalsePositive?${encodeURIComponent(JSON.stringify({ eventId: event.id }))}`;
      
      contents.appendMarkdown(`[Update Intent](${updateCmd}) | [Dismiss](${dismissCmd}) | [False Positive](${falsePositiveCmd})\n`);
    }

    return new vscode.Hover(contents);
  }
}
