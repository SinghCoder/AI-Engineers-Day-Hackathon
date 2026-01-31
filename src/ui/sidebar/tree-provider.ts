import * as vscode from "vscode";
import * as path from "path";
import { IntentMeshService } from "../../services/intent-mesh-service";
import { IntentNode } from "../../models/intent";
import { DriftEvent } from "../../models/drift";

type TreeItemType = "intent" | "drift" | "intent-header" | "drift-header" | "link";

interface TreeItemData {
  type: TreeItemType;
  intent?: IntentNode;
  drift?: DriftEvent;
  label: string;
}

export class IntentMeshTreeProvider implements vscode.TreeDataProvider<TreeItemData> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemData | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private intents: IntentNode[] = [];
  private driftEvents: DriftEvent[] = [];

  constructor(private readonly service: IntentMeshService) {
    // Listen for changes
    service.onIntentsChanged((intents) => {
      this.intents = intents;
      this.refresh();
    });

    service.onDriftDetected(async () => {
      this.driftEvents = await service.getDriftEvents();
      this.refresh();
    });

    // Initial load
    this.loadData();
  }

  private async loadData(): Promise<void> {
    this.intents = await this.service.getAllIntents();
    this.driftEvents = await this.service.getDriftEvents();
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItemData): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    switch (element.type) {
      case "intent-header":
        item.iconPath = new vscode.ThemeIcon("book");
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        item.description = `(${this.intents.length})`;
        break;

      case "drift-header":
        item.iconPath = new vscode.ThemeIcon("warning");
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        const openCount = this.driftEvents.filter((e) => e.status === "open").length;
        item.description = `(${openCount} open)`;
        break;

      case "intent":
        if (element.intent) {
          item.iconPath = this.getIntentIcon(element.intent);
          item.collapsibleState = vscode.TreeItemCollapsibleState.None;
          item.tooltip = element.intent.statement;
          item.description = element.intent.tags.join(", ");
          item.command = {
            command: "intentmesh.showIntentDetails",
            title: "Show Intent Details",
            arguments: [element.intent],
          };
        }
        break;

      case "drift":
        if (element.drift) {
          item.iconPath = this.getDriftIcon(element.drift);
          item.collapsibleState = vscode.TreeItemCollapsibleState.None;
          item.tooltip = element.drift.explanation;
          item.description = path.basename(element.drift.fileUri.replace(/^file:\/\//, ""));
          item.command = {
            command: "intentmesh.goToDrift",
            title: "Go to Drift",
            arguments: [element.drift],
          };
        }
        break;
    }

    return item;
  }

  getChildren(element?: TreeItemData): TreeItemData[] {
    if (!element) {
      // Root level - show headers
      return [
        { type: "intent-header", label: "Intents" },
        { type: "drift-header", label: "Drift Events" },
      ];
    }

    switch (element.type) {
      case "intent-header":
        return this.intents
          .filter((i) => i.status === "active")
          .map((intent) => ({
            type: "intent" as const,
            intent,
            label: intent.title,
          }));

      case "drift-header":
        return this.driftEvents
          .filter((e) => e.status === "open")
          .map((drift) => ({
            type: "drift" as const,
            drift,
            label: drift.summary,
          }));

      default:
        return [];
    }
  }

  private getIntentIcon(intent: IntentNode): vscode.ThemeIcon {
    switch (intent.strength) {
      case "strong":
        return new vscode.ThemeIcon("shield", new vscode.ThemeColor("charts.green"));
      case "medium":
        return new vscode.ThemeIcon("bookmark", new vscode.ThemeColor("charts.blue"));
      case "weak":
        return new vscode.ThemeIcon("note", new vscode.ThemeColor("charts.yellow"));
    }
  }

  private getDriftIcon(drift: DriftEvent): vscode.ThemeIcon {
    switch (drift.severity) {
      case "error":
        return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
      case "warning":
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
      case "info":
        return new vscode.ThemeIcon("info", new vscode.ThemeColor("editorInfo.foreground"));
    }
  }
}
