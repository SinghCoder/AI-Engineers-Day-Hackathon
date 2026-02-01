import { z } from "zod";

export const ExtractedIntentSchema = z.object({
  title: z.string().min(3).max(50).describe("Short descriptive name (2-5 words)"),
  statement: z.string().min(10).max(500).describe("Requirement statement: 'System must...', 'Only...', or 'Field must...' (keep concise, under 500 chars)"),
  confidence: z.enum(["high"]).describe("Only 'high' confidence - user must explicitly state the requirement"),
  evidence: z.string().describe("Exact quote from USER message only, not assistant response"),
  tags: z.array(z.string()).min(1).max(3).describe("1-3 tags from: auth, security, validation, business-logic, data, access-control"),
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
