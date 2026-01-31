import { AttributionSpan } from "../core/attribution-source";

export interface Range {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export type DriftType = "intent_violation" | "architecture_drift" | "orphan_behavior";
export type DriftSeverity = "info" | "warning" | "error";
export type DriftStatus = "open" | "acknowledged" | "resolved" | "false_positive";

export interface DriftEvent {
  id: string;
  
  fileUri: string;
  range: Range;
  
  type: DriftType;
  severity: DriftSeverity;
  confidence: number;
  
  intentIds: string[];
  summary: string;
  explanation: string;
  suggestedFix?: string;
  
  attribution?: AttributionSpan;
  
  status: DriftStatus;
  createdAt: Date;
  resolvedAt?: Date;
}

export function createDriftEvent(params: {
  fileUri: string;
  range: Range;
  type?: DriftType;
  severity: DriftSeverity;
  confidence: number;
  intentIds: string[];
  summary: string;
  explanation: string;
  suggestedFix?: string;
  attribution?: AttributionSpan;
}): DriftEvent {
  return {
    id: crypto.randomUUID(),
    fileUri: params.fileUri,
    range: params.range,
    type: params.type ?? "intent_violation",
    severity: params.severity,
    confidence: params.confidence,
    intentIds: params.intentIds,
    summary: params.summary,
    explanation: params.explanation,
    suggestedFix: params.suggestedFix,
    attribution: params.attribution,
    status: "open",
    createdAt: new Date(),
  };
}
