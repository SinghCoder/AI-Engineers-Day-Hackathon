import { SourceReference } from "../core/intent-source";

export type IntentCategory = 
  | "behavior"
  | "security"
  | "architecture"
  | "performance"
  | "compliance";

export interface IntentConstraint {
  type: string;
  value: string;
  description?: string;
}

export interface IntentNode {
  id: string;
  title: string;
  statement: string;
  
  tags: string[];
  category: IntentCategory;
  strength: "weak" | "medium" | "strong";
  status: "active" | "superseded" | "archived";
  
  sources: SourceReference[];
  createdAt: Date;
  updatedAt: Date;
  
  constraints?: IntentConstraint[];
}

export interface IntentLink {
  id: string;
  intentId: string;
  
  fileUri: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  
  linkType: "extracted" | "inferred" | "manual";
  confidence: number;
  rationale?: string;
  
  createdAt: Date;
  createdBy: "system" | "user";
}

// Factory functions
export function createIntentNode(params: {
  title: string;
  statement: string;
  tags?: string[];
  category?: IntentCategory;
  strength?: "weak" | "medium" | "strong";
  sources?: SourceReference[];
}): IntentNode {
  return {
    id: crypto.randomUUID(),
    title: params.title,
    statement: params.statement,
    tags: params.tags ?? [],
    category: params.category ?? "behavior",
    strength: params.strength ?? "medium",
    status: "active",
    sources: params.sources ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function createIntentLink(params: {
  intentId: string;
  fileUri: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  linkType?: "extracted" | "inferred" | "manual";
  confidence?: number;
  rationale?: string;
}): IntentLink {
  return {
    id: crypto.randomUUID(),
    intentId: params.intentId,
    fileUri: params.fileUri,
    startLine: params.startLine,
    endLine: params.endLine,
    symbol: params.symbol,
    linkType: params.linkType ?? "inferred",
    confidence: params.confidence ?? 0.5,
    rationale: params.rationale,
    createdAt: new Date(),
    createdBy: "system",
  };
}
