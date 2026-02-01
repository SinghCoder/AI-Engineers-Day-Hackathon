export const EXTRACT_INTENTS_SYSTEM_PROMPT = `Extract BUSINESS LOGIC INTENTS from a user's conversation with an AI coding assistant.

AN INTENT IS:
A business rule, security constraint, or data validation requirement that:
- Describes WHAT the system must do or prevent (not HOW to structure code)
- Can be violated by future code changes
- Would cause a bug or security issue if ignored

EXTRACT THESE:
- Security rules: "never log passwords", "mask card numbers", "encrypt PII"
- Access control: "only admins can delete", "users can only see their own data"
- Data validation: "amounts must be positive", "emails must be valid"
- Business rules: "refunds over $100 need approval", "orders must have at least one item"
- Compliance: "audit all access", "retain logs for 90 days"

DO NOT EXTRACT:
- File structure: "create src/types.ts" ❌
- Code style: "keep code clean", "minimal comments" ❌
- Framework choices: "use Express", "use Zod schemas" ❌
- Project setup: "create these files", "add these endpoints" ❌
- Implementation details: "use a Map", "export a class" ❌

OUTPUT FORMAT:
- title: 2-5 word name (e.g., "Mask card data", "Require manager approval")
- statement: "System must..." or "Field must..." - the rule that can be checked
- evidence: Exact quote from USER message proving they stated this requirement
- tags: 1-3 from [security, validation, business-logic, auth, data, access-control]

Extract 3-6 high-quality business intents. Skip anything about code structure or style.`;

export const DETECT_DRIFT_SYSTEM_PROMPT = `You are a strict code reviewer checking for CLEAR VIOLATIONS of stated requirements.

STRICT RULES - Only flag violations if:
1. The code DIRECTLY AND CLEARLY violates the intent (not speculation)
2. You can point to SPECIFIC lines that break the rule
3. The violation is in THIS code, not hypothetical code elsewhere
4. Confidence >= 0.9 for errors, >= 0.8 for warnings

DO NOT FLAG:
- "Implementation not verified" - if you can't see it, don't flag it
- "Relies on external validation" - trusting other modules is correct
- Code that CORRECTLY implements the intent (even partially)
- Violations that MIGHT happen depending on other code
- Intents that don't apply to this file (e.g., refund rules in payments.ts)
- Missing features that aren't violations of stated intents

ONLY FLAG:
- Code that LOGS sensitive data in plaintext (e.g., console.log(card))
- Code that STORES sensitive data unmasked
- Code that BYPASSES required checks (e.g., skip approval flag)
- Code that ACCEPTS invalid input (e.g., negative amounts without validation)

For each CLEAR violation:
- intentId: ID of the violated intent
- severity: "error" only for definite violations, "warning" for likely issues
- summary: One-line factual description
- explanation: Why this specific code violates the intent
- lineStart/lineEnd: Exact lines (1-indexed)
- confidence: 0.9+ for errors, 0.8+ for warnings
- suggestedFix: Concrete fix

When in doubt, DO NOT flag. Return empty violations array if code is compliant.`;

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

  // Check if code has line number prefixes (e.g., "42: const x = 1")
  const hasLineNumbers = /^\d+:/.test(params.code.split("\n")[0] || "");
  const lineNote = hasLineNumbers 
    ? "\n\nNOTE: Each line is prefixed with its absolute line number (e.g., '42: code'). Use these EXACT line numbers in your lineStart/lineEnd fields."
    : "";

  return `## Intents to check:
${intentsText}

## Code to analyze (${params.filePath}, ${params.language}):
\`\`\`${params.language}
${params.code}
\`\`\`
${lineNote}
Analyze this code and identify any violations of the stated intents.`;
}
