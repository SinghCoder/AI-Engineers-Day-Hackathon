# IntentMesh Demo

This folder contains mock data to test IntentMesh end-to-end.

## What's Included

### 1. Conversation File
- `conversation-refund-feature.json` - A sample agent conversation about building a refund system

**Extracted Intents:**
1. **Admin-only refunds** - Only admins can process refunds
2. **No PII in logs** - Never log customer emails/names
3. **JWT validation** - Validate JWT on every request
4. **Max refund $10,000** - Limit per transaction

### 2. Code with Intentional Bugs
- `refund-controller.ts` - Code that violates the intents

**Bugs to Detect:**
1. **Line 44**: Allows `support` role, not just `admin` ❌
2. **Line 61**: Logs `customerEmail` (PII) ❌
3. **Line 85**: `getRefundHistory` doesn't validate JWT ❌

### 3. Agent Trace
- `.agent-trace/refund-controller.agent-trace.json` - Links code to the conversation

### 4. Pre-loaded Intent Data
- `.intentmesh/intent-graph.json` - Pre-extracted intents
- `.intentmesh/links.json` - Pre-linked to code locations
- `.intentmesh/drift-events.json` - Empty, will populate on analysis

## How to Test

### Option A: Use Pre-loaded Data
1. Open the `demo` folder as a workspace in VSCode
2. Run the extension (F5)
3. Open `refund-controller.ts`
4. Save the file (Cmd+S)
5. See drift violations appear as squiggles

### Option B: Import Fresh
1. Open any workspace
2. Run command: `IntentMesh: Import Conversation`
3. Select `conversation-refund-feature.json`
4. Review and confirm extracted intents
5. Manually link intents to code
6. Edit and save to trigger drift detection

## Expected Results

After running drift detection on `refund-controller.ts`, you should see:

| Line | Violation | Severity |
|------|-----------|----------|
| 44 | Support role allowed, should be admin-only | Error |
| 61 | PII (customerEmail) logged | Error |
| 85 | Missing JWT validation | Warning |
