export const EXTRACT_INTENTS_SYSTEM_PROMPT = `IMPORTANT: Extract only USER-STATED INTENTS from the conversation. Ignore assistant responses, explanations, or suggestions.

WHAT IS AN INTENT:
An intent is a specific, verifiable requirement or constraint explicitly stated by the USER. It must:
- Be testable/verifiable in code
- Not be vague, speculative, or meta-discussion
- Be a concrete behavioral rule, not implementation detail chatter
- Only come from USER messages, never from assistant responses

WHAT TO EXTRACT:
- Explicit requirements: "must", "should", "only", "no"
- Authentication/authorization rules: "Only X can do Y", "users must..."
- Data validation rules: "field must be...", "field cannot contain..."
- Business logic rules: specific conditions or constraints
- Security requirements: "passwords must...", "tokens must..."

WHAT TO IGNORE (even if mentioned):
- Assistant suggestions or explanations
- Vague discussions like "we should think about..."
- Implementation details like "use React" or "JavaScript"
- Questions followed by assistant answers
- Small talk or non-requirement conversation
- Duplicate of another intent already in the list

For each intent you extract:
- title: Short name of the requirement (2-5 words)
- statement: Starting with "System must...", "Only...", or "Field must..."
- confidence: "high" if user explicitly stated it clearly
- evidence: Exact quote from USER message only
- tags: Categories like ["auth", "security", "validation", "business-logic"]

Maximum 5-10 intents per conversation. Better to extract nothing than vague intent.`;

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
  return `Here is the conversation. Extract intents ONLY from messages marked "USER:".\n\n${messages
    .map((m) => {
      const label = m.role === "user" ? "USER" : "ASSISTANT";
      return `${label}:\n${m.content}`;
    })
    .join("\n\n---\n\n")}`;
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
