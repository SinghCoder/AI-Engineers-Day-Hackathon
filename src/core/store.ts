import { IntentNode, IntentLink } from "../models/intent";
import { DriftEvent } from "../models/drift";

export interface IntentQuery {
  tags?: string[];
  status?: "active" | "superseded" | "archived";
  search?: string;
}

export interface DriftQuery {
  fileUri?: string;
  intentId?: string;
  status?: "open" | "acknowledged" | "resolved" | "false_positive";
  severity?: "info" | "warning" | "error";
}

export interface IIntentStore {
  getIntent(id: string): Promise<IntentNode | null>;
  getAllIntents(): Promise<IntentNode[]>;
  findIntents(query: IntentQuery): Promise<IntentNode[]>;
  saveIntent(intent: IntentNode): Promise<void>;
  deleteIntent(id: string): Promise<void>;

  getLinksForIntent(intentId: string): Promise<IntentLink[]>;
  getLinksForFile(fileUri: string): Promise<IntentLink[]>;
  saveLink(link: IntentLink): Promise<void>;
  deleteLink(id: string): Promise<void>;

  getDriftEvents(query: DriftQuery): Promise<DriftEvent[]>;
  saveDriftEvent(event: DriftEvent): Promise<void>;
  clearDriftEvents(fileUri?: string): Promise<void>;

  load(): Promise<void>;
  save(): Promise<void>;
}
