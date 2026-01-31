import { z } from "zod";

export const ExtractedIntentSchema = z.object({
  title: z.string().describe("Short descriptive name for the intent"),
  statement: z.string().describe("Normalized requirement statement starting with 'System must...' or similar"),
  confidence: z.enum(["high", "medium", "low"]).describe("Confidence level based on how explicit the requirement was"),
  evidence: z.string().describe("Exact quote from the conversation that supports this intent"),
  tags: z.array(z.string()).describe("Relevant categories like 'auth', 'security', 'payments'"),
});

export const ExtractIntentsResponseSchema = z.object({
  intents: z.array(ExtractedIntentSchema),
});

export const DriftViolationSchema = z.object({
  intentId: z.string().describe("ID of the violated intent"),
  severity: z.enum(["info", "warning", "error"]).describe("How severe is this violation"),
  summary: z.string().describe("One-line summary of the violation"),
  explanation: z.string().describe("Detailed explanation of why this is a violation"),
  lineStart: z.number().describe("Start line number (1-indexed, relative to the provided snippet)"),
  lineEnd: z.number().describe("End line number (1-indexed, relative to the provided snippet)"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1"),
  suggestedFix: z.string().optional().describe("Suggested fix for the violation"),
});

export const DriftAnalysisSchema = z.object({
  violations: z.array(DriftViolationSchema),
});

export type ExtractedIntentType = z.infer<typeof ExtractedIntentSchema>;
export type DriftViolationType = z.infer<typeof DriftViolationSchema>;
export type DriftAnalysisType = z.infer<typeof DriftAnalysisSchema>;
