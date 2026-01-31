export const EXTRACT_INTENTS_SYSTEM_PROMPT = `You are an expert at analyzing developer-agent conversations to extract explicit and implicit requirements.

Your task is to identify:
1. Explicit requirements stated by the user (e.g., "only admins should be able to...")
2. Constraints or rules agreed upon during the conversation
3. Architectural decisions made
4. Security and authentication requirements
5. Business logic rules

For each intent you extract:
- title: A short, descriptive name (e.g., "Admin-only refunds")
- statement: A normalized requirement starting with "System must..." or "Only..." or similar
- confidence: "high" if explicitly stated, "medium" if clearly implied, "low" if inferred
- evidence: The exact quote from the conversation that supports this intent
- tags: Relevant categories like ["auth", "security", "payments", "validation"]

Focus on behavioral requirements that can be verified in code. Ignore vague or implementation-detail discussions.`;

export const DETECT_DRIFT_SYSTEM_PROMPT = `You are an expert code reviewer checking if code adheres to stated intents/requirements.

You will be given:
1. A list of intents (requirements/constraints) that should be satisfied
2. A code snippet to analyze

Your task is to identify any violations where the code does NOT satisfy an intent.

For each violation found:
- intentId: The ID of the violated intent
- severity: "error" for clear violations, "warning" for potential issues, "info" for minor concerns
- summary: One-line description of the issue
- explanation: Detailed explanation of why this violates the intent
- lineStart/lineEnd: Line numbers within the snippet (1-indexed)
- confidence: 0-1 score of how confident you are this is a real violation
- suggestedFix: Optional suggestion for how to fix it

Be precise. Only flag real violations, not stylistic issues. If the code correctly implements the intent, return an empty violations array.`;

export function formatConversationForExtraction(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

export function formatDriftCheckInput(params: {
  intents: { id: string; title: string; statement: string; evidence?: string }[];
  code: string;
  filePath: string;
  language: string;
}): string {
  const intentsText = params.intents
    .map((i, idx) => `${idx + 1}. [${i.id}] ${i.title}: ${i.statement}${i.evidence ? ` (Evidence: "${i.evidence}")` : ""}`)
    .join("\n");

  return `## Intents to check:
${intentsText}

## Code to analyze (${params.filePath}, ${params.language}):
\`\`\`${params.language}
${params.code}
\`\`\`

Analyze this code and identify any violations of the stated intents.`;
}
