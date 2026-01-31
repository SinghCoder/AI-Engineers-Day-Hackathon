# IntentMesh – Keeping Agent‑Written Code Aligned With Intent

## 0. One‑liner

**IntentMesh** builds a living “intent graph” for your codebase (from specs + conversations + architecture decisions) and continuously checks if agent‑written code is drifting away from that intent or forking the architecture.

Agents can ship code.  
IntentMesh makes sure the system is still what you meant to build.

---

## 1. Goals & Non‑Goals

### 1.1 Goals

- Detect **intent drift**:
  - code behaviour silently diverges from product/spec/conversation intent.
- Detect **architecture drift**:
  - agents introduce duplicate/conflicting concepts and patterns.
- Work **with** agentic development:
  - agents write large amounts of code  
  - humans mostly define intent, approve big moves, fix weird cases.
- Provide **proactive feedback**:
  - inside the editor (VSCode)  
  - at PR time (GitHub/GitLab)
- Use **Agent Trace‑style attribution** (About agent trace - https://agent-trace.dev/) and **agent conversation logs** as first‑class signals:
  - “who/what wrote this”  
  - “what did they think they were implementing”
- Create intents from those agent traces. what did humans have in mind when they implemented the code using agents?

### 1.2 Non‑Goals (for now)

- Not a generic “AI code reviewer” (like Coderrabbit / Copilot PR).  
- Not trying to replace tests/linters/types.  
- Not running agents to automatically refactor entire repos.  
- Not a spec authoring tool; we assume someone already has a spec/ADR/tickets.

---

## 2. Context & Motivation

### 2.1 Agentic dev reality

We assume a near‑future org where:

- Agents write **thousands of lines per dev per day**.  
- Agents do **PR review**, **refactors**, **migrations**.  
- Humans:
  - define intent in docs and in conversations with agents  
  - approve high‑risk changes  
  - debug serious incidents.

### 2.2 Existing primitives: Agent Trace

Cursor’s **Agent Trace** spec (https://agent-trace.dev/) standardizes:

- Line‑level AI attribution in git:
  - model id, tool, timestamps, ranges, convo URLs
- Vendor-neutral format shared across tools.

This gives us a reliable primitive:  
> “For each line, we know which model/agent wrote or edited it.”

IntentMesh is designed to **consume** Agent Trace style data (or equivalent) as input.

---

## 3. Core Concepts

We want the system to reason about **intent**, **implementation**, and **agents**.

### 3.1 Intent Nodes

Atomic pieces of “what the system is supposed to do / be”.

Sources:

- Product specs / PRDs / tickets  
- ADRs and architecture docs  
- Agent–human conversations (instructions and promises)

Examples:

- `auth.role.admin_refunds_only`  
  - “Only admins can refund payments.”
- `checkout.guest_without_password`  
  - “Guest checkout must not require password creation.”
- `identity.user_id_canonical`  
  - “User is globally identified by `user_id`, not email.”
- `domain.workspace_singular`  
  - “Workspace is the only account container.”

Each Intent Node has:

- ID (stable string key)  
- Natural language description  
- Optional constraints/invariants (structured fields)  
- References back to source text (spec section, chat snippet, ADR).

### 3.2 Architecture Concepts

Higher‑level system shape:

- Entities (User, Workspace, Organization, Invoice, Plan, etc.)  
- Domains/services (Billing, Auth, Notifications)  
- Cross‑cutting patterns (auth approach, tenancy model, error handling schema, date/time policy)

These are also represented as Intent‑like objects but at “architecture” granularity.

### 3.3 Code Elements

Pieces of code we can map to intents:

- Files, functions, methods, classes  
- Routes/endpoints  
- Tests and test suites

Each Code Element has metadata:

- Path, language, symbols, signatures  
- Optional tags (e.g. “controller”, “repository”, “route: /refund”).

### 3.4 Implementation Links

Mappings from **Intent Nodes / Architecture Concepts → Code Elements / Tests**.

- “Intent `auth.role.admin_refunds_only` is implemented by:  
  - `RefundController.handleRefund`  
  - `AuthService.requireAdmin`  
  - test `test_only_admin_can_refund`”
- “Architecture concept `domain.workspace_singular` is embodied by:  
  - DB schema `workspaces`  
  - `WorkspaceService`  
  - middleware `attachWorkspace`”.

Links are created by:

- Static analysis (routes, types, imports)  
- LLM mapping (given intent text, find relevant code regions)  
- Optional manual annotations.

### 3.5 Agent Sessions & Attribution

We track **agent sessions** and **trace records**:

- Agent session:
  - human instructions  
  - agent reasoning / plan  
  - claimed changes (“I added an admin check.”)
- Trace record (Agent Trace style):
  - which model/agent wrote which line(s)  
  - commit/PR ids

These let us answer:

- “What did the human ask for?”  
- “What did the agent think it implemented?”  
- “What actually changed in the code?”

### 3.6 Drift Events

When new code diverges from intent or architecture, we create **Drift Events**.

Types:

- **Intent drift** – behaviour no longer matches an Intent Node.  
- **Architecture drift** – new concept overlaps/contradicts an existing one.  
- **Orphan behaviour** – significant behaviour with no linked intent.

Each Drift Event includes:

- Affected intents/concepts  
- Code elements involved  
- Detection time + severity  
- Related PRs/commits and agent attributions.

---

## 4. System Architecture (High‑Level)

Components:

1. **Indexer / CLI**  
   - Scans repo + spec docs + (optionally) conversation logs.  
   - Builds/updates the Intent Graph and Implementation Links.  

2. **Analyzer Service (backend)**  
   - Core logic: drift detection, graph queries, scoring.  
   - Exposes API endpoints for editor and CI/PR integration.

3. **Storage**  
   - Intent Nodes, Architecture Concepts  
   - Code Elements + mappings  
   - Drift Events  
   - Agent attribution metadata

4. **VSCode Extension** (editor integration)  
   - Shows intents and mappings  
   - Runs local/proxied checks on save  
   - Renders inline drift warnings.

5. **GitHub/GitLab App** (PR integration)  
   - Listens to PR webhooks  
   - Calls analyzer on diff  
   - Posts comments / status checks.

For hackathon MVP, most components can be simplified (single process, local storage), but keep this structure in mind.

---

## 5. Data Flow

### 5.1 Initial Indexing

Inputs:

- Repository (git checkout)  
- Spec/ADR files (Markdown, etc.)  
- Optional: agent conversation transcripts (text)  
- Optional: Agent Trace data (JSON)

Steps:

1. **Parse specs & ADRs**  
   - Extract candidate Intent Nodes from headings, bullet points, requirements.  
   - Extract Architecture Concepts from ADRs and domain docs.

2. **Map intents to code**  
   - For each Intent Node, use:
     - static heuristics (route names, function names, comments)  
     - LLM semantic search over code  
   - Produce Implementation Links:
     - intent → code elements  
     - intent → tests (if any).

3. **Map architecture concepts to code**  
   - Entities → schemas, models, types  
   - Domains → module boundaries, packages.

4. **Store graph**  
   - Intent + Concepts + Code Elements + Links in storage.

Output:

- A baseline Intent Graph tied to current code.

---

### 5.2 On Code Edit (VSCode, proactive)

Trigger:

- Developer or AI agent edits file(s) in VSCode and saves.

Flow:

1. Extension captures:
   - changed file(s)  
   - diff (before/after)  
   - optional: link to agent session if code came from an agent.

2. Extension sends to Analyzer:
   - file path + diff  
   - repo id / branch  
   - optional agent metadata.

3. Analyzer:

   - Finds relevant Intent Nodes / Concepts:
     - via Implementation Links on touched code  
     - plus additional LLM search if needed.

   - For each relevant intent:
     - compares old vs new code semantics with respect to intent description.  
     - decides: likely preserved / possibly violated / unknown.

   - For architecture:
     - detects new types/entities in diff  
     - compares against existing concepts (field overlaps, naming, domain)  
     - marks potential concept clash.

4. Analyzer returns warnings to extension:

   - Intent drift warnings:
     - “Possible violation of `auth.role.admin_refunds_only` in this change.”
   - Architecture drift / concept clash:
     - “New entity `Organization` overlaps with existing `Workspace` concept.”

5. Extension renders:

   - squiggles / gutter icons at affected lines  
   - popup with:
     - Intent description  
     - relevant spec snippet  
     - why this looks risky  
     - options such as:
       - “View intent details”  
       - “Ignore for now”  
       - “Mark as new intent (requires confirmation).”

---

### 5.3 On PR / Merge Request

Trigger:

- PR opened or updated on GitHub/GitLab.

Flow:

1. GitHub App receives webhook with diff / commit range.

2. It calls Analyzer:

   - Provide:
     - repo, branch, commit range  
     - diff  
     - optional Agent Trace info for that PR.

3. Analyzer:

   - Identifies Intent Nodes touched by diff (via Implementation Links and LLM search).  
   - For each:
     - classify impact:
       - safe / behaviour-preserving  
       - suspicious / drift  
       - unknown / requires human review
   - Identifies architecture changes:
     - new entities/concepts  
     - modifications to existing patterns  
     - concept clashes.

4. Analyzer generates a **PR review summary**:

   Example:

   > **IntentMesh – Intent Drift Checks**  
   >  
   > 1. `auth.role.admin_refunds_only`  
   >    - Spec: “Only admins can refund payments.”  
   >    - Change: new handler `SupportRefundController` adds refund path without role check.  
   >    - Status: 🚨 likely violation.  
   >    - Suggestion: enforce `requireAdmin()` here or update intent if product policy changed.  
   >  
   > 2. `domain.workspace_singular`  
   >    - Spec: “Workspace is the only account container.”  
   >    - Change: new entity `Organization` introduced with similar fields.  
   >    - Status: ⚠️ possible concept clash.  
   >    - Suggestion: clarify if `Organization` is a new concept; if yes, promote to new intent node.

5. GitHub App posts this as:

   - Either a single comment on the PR  
   - Or as a “check run” with a summary and linked annotations.

---

### 5.4 Periodic Architecture Scan

Trigger:

- Scheduled (e.g. nightly cron), or manual `intentmesh scan-architecture`.

Flow:

1. Analyzer reviews entire repo:

   - Entities/schemas/models  
   - Shared patterns (auth, logging, error handling).

2. Clusters similar entities/patterns:

   - using structure (fields, relationships), naming, call graph proximity.

3. Detects architecture drift:

   - duplicated concepts with no explicit intent separation  
   - multiple incompatible patterns for the same cross‑cutting concern.

4. Emits high‑level findings:

   - “Found 3 entity types that look like ‘account container’: Workspace, Team, Organization.”  
   - “Detected 2 different auth flows: session‑based and token‑based, both used in user‑facing routes.”

Exposed via:

- CLI output  
- dashboard  
- or simple JSON/markdown report.

---

### 5.5 Intent Update Flow

Sometimes drift is actually **correct evolution**:

- Product changed  
- Architecture evolved deliberately

Flow:

1. A detected drift is reviewed by human.  
2. If change is **intended**, human can:

   - convert that drift into an **Intent update**:
     - update description  
     - update constraints  
     - add new nodes for new concepts
3. Analyzer then:

   - updates Intent Graph  
   - re‑indexes mappings  
   - no longer flags those changes as drift.

This keeps the graph representing the *current* truth, while still catching accidental divergence.

---

## 6. Using Conversations & Agent Trace

### 6.1 Conversations as Intent Source

For each agent session, we may store:

- Human instructions:
  - “Make refunds available to support team, but still only admins can execute actual refund operation.”
- Agent plan / explanation:
  - “I will add UI in support dashboard but reuse existing admin‑only refund API.”
- Agent claims at the end:
  - “I added checks to ensure only admins can trigger a refund.”

IntentMesh can:

- extract new micro‑intent nodes from such conversations  
- connect those to code diffs and PRs  
- check whether the actual changes satisfy **both**:
  - formal spec  
  - conversational intent.

### 6.2 “Agent lied / misunderstood” detection

We can compare:

- What human asked for  
- What agent claimed to implement  
- What code actually does

If mismatch:

- create a Drift Event with reason:
  - “Agent claimed to enforce admin‑only refunds, but this log/branch allows non‑admin access.”

Coderrabbit‑style reviewers cannot do this because they never see the agent session.

### 6.3 Agent Trace as attribution layer

Given Agent Trace records, IntentMesh can:

- attribute drift events to specific models/agents  
- compute stats:
  - “Model X tends to cause auth-related intent drift in `billing/*`.”  
- allow policies:
  - “Do not allow model X to touch intents under `auth.*`.”

MVP can just store the agent id/model id where available; full policies can be future work.

---

## 7. vs “Just a Smart AI Code Reviewer” (Coderrabbit etc.)

Assume a very strong code reviewer:

- Can read diff + entire repo + spec.  
- Has cross‑PR and multi‑repo memory.

Still, IntentMesh differs in 3 key ways:

1. **Intent is a persistent graph, not just context text**  
   - Reviewer: spec is extra tokens; it may or may not remember specific constraints.  
   - IntentMesh: extracts intent into structured nodes and keeps them *forever*, mapped to code.

2. **System‑level drift, not PR‑only**  
   - Reviewer: judges each PR independently.  
   - IntentMesh: sees multi‑PR, multi‑agent patterns:
     - 5 “safe” PRs that together fork `Workspace` into `Organization`  
     - repeated softening of invariants across modules.

3. **Conversation‑aware, agent‑aware**  
   - Reviewer: sees only diff vs spec.  
   - IntentMesh: also sees what you told your agents and what they claimed to do, and compares it to actual code.

IntentMesh is not “another reviewer model”; it’s **a layer that maintains and enforces long‑term intent/architecture alignment** across agentic development.

---

## 8. MVP Scope (for build agent)

This is what you should actually implement first.
-
### 8.1 Constraints

- Single repo (Node/TS or Python, pick one).  
- Single markdown spec file describing 5–10 behavioural rules and 2–3 architecture decisions.  
- No real Datadog, no real multi‑service; fake as needed.

### 8.2 MVP Features

1. CLI command: `intentmesh init`
   - Parse spec.md → create 5–10 Intent Nodes.  
   - Map them to code heuristically (routes + simple LLM matching).  
   - Store graph locally (any simple DB / JSON).

2. CLI command: `intentmesh analyze-diff <diff-file>`
   - Input: unified diff file.  
   - Output: JSON of:
     - impacted intents  
     - suspected drifts  
     - suspected concept clashes (basic: new entity name similar to existing).

3. VSCode extension:
   - On save, compute diff (before/after) and call `analyze-diff`.  
   - Highlight lines with suspected intent drift.  
   - Show hover with:
     - intent description  
     - spec snippet  
     - short explanation.

4. Simple PR integration (if time):
   - GitHub Action that runs `intentmesh analyze-diff` on PR diff and posts result as a comment.

### 8.3 Nice-to-have but optional

- Basic architecture concept detection (entities from ORM/schema).  
- Very simple clustering of similar entities (field‑overlap).  
- Recording agent id/model id from Agent Trace JSON if available.
