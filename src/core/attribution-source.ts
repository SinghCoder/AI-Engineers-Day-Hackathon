import { Disposable } from "./types";

export interface Contributor {
  type: "human" | "ai" | "mixed" | "unknown";
  modelId?: string;
  toolId?: string;
  userId?: string;
}

export interface AttributionSpan {
  fileUri: string;
  startLine: number;
  endLine: number;
  contributor: Contributor;
  conversationUrl?: string;
  conversationId?: string;
  timestamp?: Date;
  revision?: string;
  contentHash?: string;
}

export interface AttributionChangeEvent {
  fileUri: string;
  changeType: "added" | "modified" | "deleted";
}

export interface IAttributionSource {
  readonly id: string;
  readonly name: string;

  isAvailable(): Promise<boolean>;
  getFileAttribution(fileUri: string): Promise<AttributionSpan[]>;
  getRangeAttribution(fileUri: string, startLine: number, endLine: number): Promise<AttributionSpan[]>;
  refresh(): Promise<void>;
  watch?(callback: (event: AttributionChangeEvent) => void): Disposable;
}
