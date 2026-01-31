import { IntentNode } from "../models/intent";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ExtractedIntent {
  title: string;
  statement: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
  tags: string[];
}

export interface DriftViolation {
  intentId: string;
  severity: "info" | "warning" | "error";
  summary: string;
  explanation: string;
  lineStart: number;
  lineEnd: number;
  confidence: number;
  suggestedFix?: string;
}

export interface DriftAnalysis {
  violations: DriftViolation[];
}

export interface DriftCheckParams {
  intents: IntentNode[];
  code: string;
  filePath: string;
  language: string;
}

export interface ILLMService {
  extractIntents(messages: ConversationMessage[]): Promise<ExtractedIntent[]>;
  detectDrift(params: DriftCheckParams): Promise<DriftAnalysis>;
}
