import { Disposable } from "vscode";

export type IntentSourceType =
  | "conversation"
  | "specification"
  | "architecture"
  | "code"
  | "manual";

export interface Evidence {
  type: "quote" | "link" | "screenshot";
  content: string;
  location?: string;
}

export interface SourceReference {
  sourceId: string;
  sourceType: IntentSourceType;
  uri?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface RawIntent {
  statement: string;
  title: string;
  confidence: "high" | "medium" | "low";
  evidence: Evidence[];
  suggestedTags?: string[];
  sourceRef: SourceReference;
}

export interface SourceChangeEvent {
  sourceId: string;
  changeType: "added" | "modified" | "deleted";
}

export interface ExtractOptions {
  maxIntents?: number;
}

export interface IIntentSource {
  readonly id: string;
  readonly name: string;
  readonly type: IntentSourceType;

  isAvailable(): Promise<boolean>;
  extractIntents(options?: ExtractOptions): Promise<RawIntent[]>;
  watch?(callback: (event: SourceChangeEvent) => void): Disposable;
}
