# IntentMesh Architecture

## Design Principles

1. **Interface-first** — All major components defined by interfaces, implementations are swappable
2. **Dependency injection** — Components receive dependencies, never instantiate them
3. **Event-driven** — Components communicate via events, not direct calls where possible
4. **Incremental** — System works with partial data; gracefully handles missing pieces

---

## Core Abstractions

### 1. Intent Sources

Everything that can produce intents implements `IIntentSource`:

```typescript
// ============================================================
// INTENT SOURCES — Where intents come from
// ============================================================

interface IIntentSource {
  readonly id: string;
  readonly name: string;
  readonly type: IntentSourceType;
  
  /**
   * Check if this source is available/configured
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Extract raw intent candidates from this source
   */
  extractIntents(options?: ExtractOptions): Promise<RawIntent[]>;
  
  /**
   * Watch for changes (optional)
   */
  watch?(callback: (event: SourceChangeEvent) => void): Disposable;
}

type IntentSourceType = 
  | "conversation"    // Agent chats (Cursor, ChatGPT, Claude, Amp)
  | "specification"   // Specs, PRDs, tickets
  | "architecture"    // ADRs, design docs
  | "code"            // Inline annotations, doc comments
  | "manual";         // User-defined intents

interface RawIntent {
  statement: string;
  confidence: number;
  evidence: Evidence[];
  suggestedTags?: string[];
  sourceRef: SourceReference;
}

interface Evidence {
  type: "quote" | "link" | "screenshot";
  content: string;
  location?: string;  // URL, file path, line number
}

interface SourceReference {
  sourceId: string;
  sourceType: IntentSourceType;
  uri?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}
```

**Implementations:**

| Implementation | Source Type | MVP | Description |
|---------------|-------------|-----|-------------|
| `LocalMarkdownSpecSource` | specification | ✅ | Parse local `.md` spec files |
| `LocalJsonChatSource` | conversation | ✅ | Parse exported chat JSON |
| `LocalMarkdownChatSource` | conversation | ✅ | Parse markdown transcripts |
| `CursorThreadSource` | conversation | | Fetch from Cursor API |
| `AmpThreadSource` | conversation | | Fetch from Amp API |
| `NotionSource` | specification | | Notion API integration |
| `LinearSource` | specification | | Linear tickets as intents |
| `JiraSource` | specification | | Jira tickets as intents |
| `GitHubIssueSource` | specification | | GitHub issues as intents |
| `CodeAnnotationSource` | code | | Parse `@intent` comments |

---

### 2. Attribution Sources

Where we get "who wrote what" information:

```typescript
// ============================================================
// ATTRIBUTION SOURCES — Who wrote what code
// ============================================================

interface IAttributionSource {
  readonly id: string;
  readonly name: string;
  
  isAvailable(): Promise<boolean>;
  
  /**
   * Get attribution for a specific file
   */
  getFileAttribution(fileUri: string): Promise<AttributionSpan[]>;
  
  /**
   * Get attribution for a specific range
   */
  getRangeAttribution(
    fileUri: string, 
    startLine: number, 
    endLine: number
  ): Promise<AttributionSpan[]>;
  
  /**
   * Refresh/reload attribution data
   */
  refresh(): Promise<void>;
  
  watch?(callback: (event: AttributionChangeEvent) => void): Disposable;
}

interface AttributionSpan {
  fileUri: string;
  startLine: number;      // 1-indexed
  endLine: number;        // 1-indexed, inclusive
  
  contributor: Contributor;
  
  // Links back to conversation (key for intent matching)
  conversationUrl?: string;
  conversationId?: string;
  
  // When this was written
  timestamp?: Date;
  revision?: string;      // git commit SHA
  
  // Stable identifier for caching
  contentHash?: string;
}

interface Contributor {
  type: "human" | "ai" | "mixed" | "unknown";
  modelId?: string;       // "openai/gpt-4", "anthropic/claude-3"
  toolId?: string;        // "cursor", "copilot", "amp"
  userId?: string;        // human identifier if known
}
```

**Implementations:**

| Implementation | MVP | Description |
|---------------|-----|-------------|
| `AgentTraceFileSource` | ✅ | Read Agent Trace JSON files |
| `AgentTraceGitNotesSource` | | Agent Trace stored in git notes |
| `GitBlameSource` | | Fallback: use git blame for human vs unknown |
| `ManualAttributionSource` | | User-defined attribution overrides |

---

### 3. Code Analysis

How we understand the codebase:

```typescript
// ============================================================
// CODE ANALYSIS — Understanding the codebase
// ============================================================

interface ICodeAnalyzer {
  readonly supportedLanguages: string[];
  
  /**
   * Extract semantic elements from a file
   */
  analyzeFile(fileUri: string): Promise<CodeElement[]>;
  
  /**
   * Get elements in a specific range
   */
  getElementsInRange(
    fileUri: string, 
    range: Range
  ): Promise<CodeElement[]>;
  
  /**
   * Find elements matching a query
   */
  findElements(query: ElementQuery): Promise<CodeElement[]>;
}

interface CodeElement {
  id: string;
  fileUri: string;
  range: Range;
  
  kind: ElementKind;
  name: string;
  signature?: string;
  
  // Semantic info
  tags?: string[];          // ["controller", "auth", "api"]
  routePath?: string;       // "/api/refunds"
  httpMethod?: string;      // "POST"
  
  // Relationships
  imports?: string[];
  exports?: string[];
  calls?: string[];
  calledBy?: string[];
}

type ElementKind = 
  | "function" 
  | "class" 
  | "method" 
  | "interface"
  | "route"
  | "middleware"
  | "schema"
  | "test";
```

**Implementations:**

| Implementation | MVP | Description |
|---------------|-----|-------------|
| `TypeScriptAnalyzer` | ✅ | TS/JS using ts-morph |
| `PythonAnalyzer` | | Python using tree-sitter |
| `TreeSitterAnalyzer` | | Generic multi-language |
| `LspAnalyzer` | | Use language server protocol |

---

### 4. LLM Layer (via LangChain)

Use **LangChain.js** instead of building custom LLM abstractions. It provides:
- Multi-provider support out of the box
- Structured output with Zod schemas
- Caching, retries, rate limiting
- Prompt templates

```typescript
// ============================================================
// LLM LAYER — Using LangChain.js
// ============================================================

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";

// Define output schemas with Zod (LangChain uses these for structured output)
const ExtractedIntentSchema = z.object({
  title: z.string(),
  statement: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.string(),
  tags: z.array(z.string()),
});

const DriftViolationSchema = z.object({
  intentId: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  summary: z.string(),
  explanation: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
  confidence: z.number(),
  suggestedFix: z.string().optional(),
});

const DriftAnalysisSchema = z.object({
  violations: z.array(DriftViolationSchema),
});

// Thin wrapper for our use cases
interface ILLMService {
  /**
   * Extract intents from a conversation
   */
  extractIntents(messages: ConversationMessage[]): Promise<ExtractedIntent[]>;
  
  /**
   * Check code against intents for drift
   */
  detectDrift(params: DriftCheckParams): Promise<DriftAnalysis>;
  
  /**
   * Generate embeddings for semantic search (optional)
   */
  embed?(texts: string[]): Promise<number[][]>;
}

interface DriftCheckParams {
  intents: IntentNode[];
  code: string;
  filePath: string;
  language: string;
}

// Implementation using LangChain
class LangChainLLMService implements ILLMService {
  private model: BaseChatModel;
  
  constructor(config: LLMConfig) {
    // LangChain handles provider switching
    switch (config.provider) {
      case "openai":
        this.model = new ChatOpenAI({
          modelName: config.model ?? "gpt-5-mini",
          temperature: 1,
          openAIApiKey: config.apiKey,
        });
        break;
      case "anthropic":
        this.model = new ChatAnthropic({
          modelName: config.model ?? "claude-3-5-sonnet-20241022",
          anthropicApiKey: config.apiKey,
        });
        break;
      case "ollama":
        this.model = new ChatOllama({
          model: config.model ?? "llama3",
          baseUrl: config.baseUrl,
        });
        break;
    }
  }
  
  async extractIntents(messages: ConversationMessage[]): Promise<ExtractedIntent[]> {
    // Use LangChain's structured output
    const structuredModel = this.model.withStructuredOutput(
      z.object({ intents: z.array(ExtractedIntentSchema) })
    );
    
    const result = await structuredModel.invoke([
      { role: "system", content: EXTRACT_INTENTS_PROMPT },
      { role: "user", content: formatConversation(messages) },
    ]);
    
    return result.intents;
  }
  
  async detectDrift(params: DriftCheckParams): Promise<DriftAnalysis> {
    const structuredModel = this.model.withStructuredOutput(DriftAnalysisSchema);
    
    const result = await structuredModel.invoke([
      { role: "system", content: DETECT_DRIFT_PROMPT },
      { role: "user", content: formatDriftCheckInput(params) },
    ]);
    
    return result;
  }
}

interface LLMConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  apiKey?: string;
  baseUrl?: string;  // For Ollama
}
```

**Why LangChain:**

| Feature | DIY | LangChain |
|---------|-----|-----------|
| Multi-provider | Build each adapter | ✅ Built-in |
| Structured output | Parse JSON manually | ✅ Zod schemas |
| Caching | Implement yourself | ✅ Built-in |
| Retries/rate limits | Implement yourself | ✅ Built-in |
| Streaming | Implement yourself | ✅ Built-in |
| Prompt templates | String interpolation | ✅ ChatPromptTemplate |

**Dependencies to add:**
```json
{
  "dependencies": {
    "@langchain/core": "^0.3.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/anthropic": "^0.3.x",  // optional
    "@langchain/ollama": "^0.1.x",     // optional
    "zod": "^3.x"
  }
}
```

---

### 5. Storage

Persist and query data:

```typescript
// ============================================================
// STORAGE — Data persistence
// ============================================================

interface IIntentStore {
  // Intent nodes
  getIntent(id: string): Promise<IntentNode | null>;
  getAllIntents(): Promise<IntentNode[]>;
  findIntents(query: IntentQuery): Promise<IntentNode[]>;
  saveIntent(intent: IntentNode): Promise<void>;
  deleteIntent(id: string): Promise<void>;
  
  // Intent links (intent → code)
  getLinksForIntent(intentId: string): Promise<IntentLink[]>;
  getLinksForFile(fileUri: string): Promise<IntentLink[]>;
  saveLink(link: IntentLink): Promise<void>;
  deleteLink(id: string): Promise<void>;
  
  // Drift events
  getDriftEvents(query: DriftQuery): Promise<DriftEvent[]>;
  saveDriftEvent(event: DriftEvent): Promise<void>;
  clearDriftEvents(fileUri?: string): Promise<void>;
}

interface IntentNode {
  id: string;
  title: string;
  statement: string;
  
  // Classification
  tags: string[];
  category: IntentCategory;
  strength: "weak" | "medium" | "strong";
  status: "active" | "superseded" | "archived";
  
  // Provenance
  sources: SourceReference[];
  createdAt: Date;
  updatedAt: Date;
  
  // Optional structured constraints
  constraints?: IntentConstraint[];
}

type IntentCategory = 
  | "behavior"        // What the system should do
  | "security"        // Auth, permissions, data protection
  | "architecture"    // Structure, patterns, boundaries
  | "performance"     // Speed, scale, efficiency
  | "compliance";     // Legal, regulatory

interface IntentLink {
  id: string;
  intentId: string;
  
  // What code this intent applies to
  fileUri: string;
  range?: Range;
  elementId?: string;
  
  // How we established this link
  linkType: "extracted" | "inferred" | "manual";
  confidence: number;
  rationale?: string;
  
  // Provenance
  createdAt: Date;
  createdBy: "system" | "user";
}

interface DriftEvent {
  id: string;
  
  // Location
  fileUri: string;
  range: Range;
  
  // Classification
  type: "intent_violation" | "architecture_drift" | "orphan_behavior";
  severity: "info" | "warning" | "error";
  confidence: number;
  
  // Details
  intentIds: string[];
  summary: string;
  explanation: string;
  suggestedFix?: string;
  
  // Attribution (who caused this)
  attribution?: AttributionSpan;
  
  // Lifecycle
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  createdAt: Date;
  resolvedAt?: Date;
}
```

**Implementations:**

| Implementation | MVP | Description |
|---------------|-----|-------------|
| `JsonFileStore` | ✅ | Simple JSON in `.intentmesh/` |
| `SQLiteStore` | | Local SQLite database |
| `PostgresStore` | | Production database |
| `CloudStore` | | Synced cloud storage |

---

### 6. Analysis Engine

The core drift detection logic:

```typescript
// ============================================================
// ANALYSIS ENGINE — Drift detection
// ============================================================

interface IAnalysisEngine {
  /**
   * Analyze a single file for drift
   */
  analyzeFile(fileUri: string, options?: AnalysisOptions): Promise<AnalysisResult>;
  
  /**
   * Analyze specific changes (for on-save)
   */
  analyzeChanges(changes: FileChange[]): Promise<AnalysisResult>;
  
  /**
   * Full workspace analysis
   */
  analyzeWorkspace(options?: AnalysisOptions): Promise<AnalysisResult>;
}

interface AnalysisOptions {
  // What to check
  checkIntentViolations?: boolean;
  checkArchitectureDrift?: boolean;
  checkOrphanBehavior?: boolean;
  
  // Scope
  includePatterns?: string[];
  excludePatterns?: string[];
  
  // Performance
  useCache?: boolean;
  maxFilesParallel?: number;
}

interface AnalysisResult {
  driftEvents: DriftEvent[];
  
  // Stats
  filesAnalyzed: number;
  intentsChecked: number;
  duration: number;
  
  // Errors (non-fatal)
  warnings: AnalysisWarning[];
}

interface FileChange {
  fileUri: string;
  changeType: "created" | "modified" | "deleted";
  diff?: string;
  changedRanges?: Range[];
}
```

---

## Service Layer

Orchestrates the components:

```typescript
// ============================================================
// SERVICE LAYER — Orchestration
// ============================================================

interface IIntentMeshService {
  // Lifecycle
  initialize(): Promise<void>;
  dispose(): void;
  
  // Intent management
  importFromSource(sourceId: string): Promise<ImportResult>;
  getIntentsForFile(fileUri: string): Promise<IntentNode[]>;
  linkIntentToCode(intentId: string, location: CodeLocation): Promise<void>;
  
  // Analysis
  analyzeOnSave(document: TextDocument): Promise<DriftEvent[]>;
  analyzeWorkspace(): Promise<AnalysisResult>;
  
  // Events
  onIntentsChanged: Event<IntentChangeEvent>;
  onDriftDetected: Event<DriftEvent[]>;
  onAnalysisComplete: Event<AnalysisResult>;
}

class IntentMeshService implements IIntentMeshService {
  constructor(
    private readonly intentSources: IIntentSource[],
    private readonly attributionSource: IAttributionSource,
    private readonly codeAnalyzer: ICodeAnalyzer,
    private readonly llmProvider: ILLMProvider,
    private readonly store: IIntentStore,
    private readonly analysisEngine: IAnalysisEngine,
  ) {}
  
  // ... implementation
}
```

---

## Dependency Injection

Use a simple DI container for wiring:

```typescript
// ============================================================
// DEPENDENCY INJECTION
// ============================================================

interface IContainer {
  register<T>(token: string, factory: () => T): void;
  registerSingleton<T>(token: string, factory: () => T): void;
  resolve<T>(token: string): T;
}

// Registration example
function configureServices(container: IContainer, config: Config) {
  // LLM Service (via LangChain)
  container.registerSingleton("llm", () => {
    return new LangChainLLMService({
      provider: config.llmProvider,        // "openai" | "anthropic" | "ollama"
      model: config.llmModel,              // e.g., "gpt-5-mini"
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,          // for Ollama
    });
  });
  
  // Storage
  container.registerSingleton("store", () => {
    switch (config.storageType) {
      case "json": return new JsonFileStore(config.workspacePath);
      case "sqlite": return new SQLiteStore(config.dbPath);
    }
  });
  
  // Intent Sources (multiple)
  container.register("intentSources", () => [
    new LocalMarkdownSpecSource(config.specPaths),
    new LocalJsonChatSource(config.chatPaths),
    // ... more based on config
  ]);
  
  // Attribution
  container.registerSingleton("attribution", () => 
    new AgentTraceFileSource(config.agentTracePaths)
  );
  
  // Code Analyzer
  container.registerSingleton("codeAnalyzer", () =>
    new TypeScriptAnalyzer()
  );
  
  // Analysis Engine
  container.registerSingleton("analysisEngine", () =>
    new AnalysisEngine(
      container.resolve("store"),
      container.resolve("attribution"),
      container.resolve("codeAnalyzer"),
      container.resolve("llm"),
    )
  );
  
  // Main Service
  container.registerSingleton("intentMesh", () =>
    new IntentMeshService(
      container.resolve("intentSources"),
      container.resolve("attribution"),
      container.resolve("codeAnalyzer"),
      container.resolve("llm"),
      container.resolve("store"),
      container.resolve("analysisEngine"),
    )
  );
}
```

---

## MVP Definition

### Goal
**Demonstrate the core value: "Import agent conversation → detect when code drifts from what was discussed"**

---

### MVP User Flows

#### Flow 1: Intent Creation (Import Conversation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. USER INITIATES IMPORT                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User runs command: "IntentMesh: Import Conversation"                  │
│                           │                                             │
│                           ▼                                             │
│   ┌─────────────────────────────────────────┐                          │
│   │ Select Source:                          │                          │
│   │  ○ Pick JSON file                       │                          │
│   │  ○ Pick Markdown file                   │                          │
│   │  ○ Paste conversation text              │                          │
│   │  ○ Enter conversation URL (future)      │                          │
│   └─────────────────────────────────────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. PARSE CONVERSATION                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Parser (based on source type) extracts:                               │
│   - Messages: [{role: "user"|"assistant", content: string}]            │
│   - Metadata: conversationUrl, timestamp, toolId                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. LLM EXTRACTS CANDIDATE INTENTS                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Prompt:                                                               │
│   "Analyze this developer-agent conversation. Extract:                  │
│    - Explicit requirements stated by the user                           │
│    - Constraints or rules agreed upon                                   │
│    - Architectural decisions made                                       │
│    - Security/auth requirements                                         │
│                                                                         │
│    For each, provide:                                                   │
│    - title: short name                                                  │
│    - statement: normalized requirement ('System must...')               │
│    - confidence: high/medium/low                                        │
│    - evidence: exact quote from conversation                            │
│    - tags: [relevant categories]"                                       │
│                                                                         │
│   Output:                                                               │
│   [                                                                     │
│     {                                                                   │
│       "title": "Admin-only refunds",                                    │
│       "statement": "Only users with admin role can process refunds",    │
│       "confidence": "high",                                             │
│       "evidence": "User: make sure only admins can do refunds",         │
│       "tags": ["auth", "payments"]                                      │
│     },                                                                  │
│     ...                                                                 │
│   ]                                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. USER REVIEWS & CONFIRMS                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   VSCode Webview Panel:                                                 │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ 📋 Extracted Intents from "auth-refund-chat.json"             │    │
│   ├───────────────────────────────────────────────────────────────┤    │
│   │                                                               │    │
│   │ ☑ Admin-only refunds                              [high] 🟢   │    │
│   │   "Only users with admin role can process refunds"            │    │
│   │   Evidence: "make sure only admins can do refunds"            │    │
│   │   Tags: auth, payments                            [Edit]      │    │
│   │                                                               │    │
│   │ ☑ JWT authentication                             [high] 🟢   │    │
│   │   "API authentication must use JWT tokens"                    │    │
│   │   Evidence: "use JWT for all API auth"                        │    │
│   │   Tags: auth, security                            [Edit]      │    │
│   │                                                               │    │
│   │ ☐ Add request logging                             [low] 🟡   │    │
│   │   "Log all API requests for debugging"                        │    │
│   │   Evidence: "maybe add some logging"                          │    │
│   │   Tags: observability                             [Edit]      │    │
│   │                                                               │    │
│   ├───────────────────────────────────────────────────────────────┤    │
│   │                              [Cancel]  [Import Selected (2)]  │    │
│   └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   User can:                                                             │
│   - ☑/☐ Toggle which intents to import                                 │
│   - [Edit] Modify title, statement, tags                               │
│   - See confidence indicators                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. SAVE INTENTS                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Selected intents saved to .intentmesh/intent-graph.json               │
│   Each intent includes:                                                 │
│   - Unique ID                                                           │
│   - Source reference (conversationUrl, file path, timestamp)           │
│   - Evidence quotes                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. AUTO-LINK TO CODE (via Agent Trace)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   The KEY JOIN: conversationUrl                                         │
│                                                                         │
│   Intent sources have:     Agent Trace spans have:                      │
│   ┌──────────────────┐     ┌──────────────────────────────────┐        │
│   │ sourceRef:       │     │ conversationUrl:                 │        │
│   │  conversationUrl:│ ════│  "https://cursor.sh/thread/abc"  │        │
│   │  "cursor.sh/abc" │     │ file: "src/refund.ts"            │        │
│   └──────────────────┘     │ lines: 10-50                     │        │
│                            │ modelId: "gpt-4"                 │        │
│                            └──────────────────────────────────┘        │
│                                                                         │
│   Linker automatically creates IntentLinks:                             │
│   - Intent "Admin-only refunds" → src/refund.ts:10-50                  │
│   - Intent "JWT authentication" → src/auth.ts:1-30                     │
│                                                                         │
│   Fallback (if no Agent Trace match):                                   │
│   - Semantic search: find code matching intent keywords                 │
│   - User can manually link via sidebar                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. READY FOR DRIFT DETECTION                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Sidebar now shows:                                                    │
│   ┌─────────────────────────────────┐                                  │
│   │ 📋 IntentMesh                   │                                  │
│   ├─────────────────────────────────┤                                  │
│   │ ▼ Intents (2)                   │                                  │
│   │   ├─ Admin-only refunds         │                                  │
│   │   │   └─ src/refund.ts:10-50   │                                  │
│   │   └─ JWT authentication         │                                  │
│   │       └─ src/auth.ts:1-30      │                                  │
│   │ ▶ Drift Events (0)              │                                  │
│   └─────────────────────────────────┘                                  │
│                                                                         │
│   Now when user edits linked files → drift detection runs on save      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Flow 2: Drift Detection (On Save)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. USER EDITS & SAVES FILE                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User edits src/refund.ts (which has linked intents)                   │
│   User saves (Cmd+S)                                                    │
│                                                                         │
│   Extension hook: onDidSaveTextDocument fires                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. GATHER CONTEXT                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   a) Get IntentLinks for this file                                      │
│      → ["Admin-only refunds" applies to lines 10-50]                   │
│                                                                         │
│   b) Get Attribution for this file (from Agent Trace)                   │
│      → [lines 10-50: gpt-4, conversation: cursor.sh/abc]               │
│                                                                         │
│   c) Get the IntentNodes                                                │
│      → [{statement: "Only admins can process refunds", ...}]           │
│                                                                         │
│   d) Read current code for linked ranges                                │
│      → code snippet from lines 10-50                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. CHECK CACHE                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Cache key = hash(fileUri + codeContent + intentIds)                   │
│                                                                         │
│   If cached result exists and code hasn't changed → skip LLM call      │
│   Else → proceed to analysis                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. LLM DRIFT ANALYSIS                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Prompt:                                                               │
│   "You are checking if code adheres to stated intents.                  │
│                                                                         │
│    INTENTS:                                                             │
│    1. Admin-only refunds: Only users with admin role can process        │
│       refunds. (Evidence: 'make sure only admins can do refunds')       │
│                                                                         │
│    CODE (src/refund.ts, lines 10-50):                                   │
│    ```typescript                                                        │
│    async function processRefund(userId: string, amount: number) {       │
│      // NEW: allow support team to refund                               │
│      if (user.role === 'admin' || user.role === 'support') {           │
│        await refundPayment(amount);                                     │
│      }                                                                  │
│    }                                                                    │
│    ```                                                                  │
│                                                                         │
│    Does this code violate any intent? Respond with JSON:                │
│    {                                                                    │
│      violations: [{                                                     │
│        intentId: string,                                                │
│        severity: 'info' | 'warning' | 'error',                         │
│        summary: string,       // one line                               │
│        explanation: string,   // detailed                               │
│        lineStart: number,     // relative to snippet                    │
│        lineEnd: number,                                                 │
│        confidence: number,    // 0-1                                    │
│        suggestedFix?: string                                            │
│      }]                                                                 │
│    }"                                                                   │
│                                                                         │
│   Response:                                                             │
│   {                                                                     │
│     "violations": [{                                                    │
│       "intentId": "admin-only-refunds",                                 │
│       "severity": "error",                                              │
│       "summary": "Refund now allowed for 'support' role, not just admin"│
│       "explanation": "The intent states only admin role can process     │
│         refunds, but this code also allows 'support' role. This may     │
│         be intentional policy change or accidental drift.",             │
│       "lineStart": 3,                                                   │
│       "lineEnd": 4,                                                     │
│       "confidence": 0.92,                                               │
│       "suggestedFix": "Remove 'support' from condition, or update       │
│         the intent if policy has changed."                              │
│     }]                                                                  │
│   }                                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. CREATE DRIFT EVENTS & DIAGNOSTICS                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Convert LLM response to DriftEvents:                                  │
│   - Map relative line numbers to absolute file positions                │
│   - Attach attribution info (modelId, conversationUrl)                  │
│   - Store in drift cache                                                │
│                                                                         │
│   Create VSCode Diagnostics:                                            │
│   - diagnosticCollection.set(fileUri, [diagnostic])                     │
│   - Squiggle appears on lines 12-13 (absolute)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. USER SEES RESULT                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Editor shows:                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ src/refund.ts                                                   │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │ 10│ async function processRefund(userId: string, amount: number)│  │
│   │ 11│ {                                                           │  │
│   │ 12│   // NEW: allow support team to refund                      │  │
│   │ 13│   if (user.role === 'admin' || user.role === 'support') { ~~│  │
│   │   │                                           ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ │  │
│   │   │                                           red squiggle      │  │
│   │ 14│     await refundPayment(amount);                            │  │
│   │ 15│   }                                                         │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   Problems panel shows:                                                 │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ ✖ Refund now allowed for 'support' role, not just admin        │  │
│   │   src/refund.ts [13, 5]                        intentmesh       │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   Hover on squiggle shows:                                              │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ ⚠️ Intent Violation: Admin-only refunds                         │  │
│   │                                                                 │  │
│   │ The intent states only admin role can process refunds,          │  │
│   │ but this code also allows 'support' role.                       │  │
│   │                                                                 │  │
│   │ 📝 Evidence: "make sure only admins can do refunds"             │  │
│   │ 🤖 Written by: gpt-4 (Cursor)                                   │  │
│   │ 💬 From conversation: [Open thread ↗]                           │  │
│   │                                                                 │  │
│   │ Suggestion: Remove 'support' from condition, or update          │  │
│   │ the intent if policy has changed.                               │  │
│   │                                                                 │  │
│   │ [Update Intent] [Dismiss] [Mark as False Positive]              │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   Sidebar updates:                                                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 📋 IntentMesh                                                   │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │ ▶ Intents (2)                                                   │  │
│   │ ▼ Drift Events (1)                                    🔴        │  │
│   │   └─ ✖ Admin-only refunds violated                              │  │
│   │       └─ src/refund.ts:13                                      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Flow 3: Intent Update (Acknowledging Drift)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ When drift is INTENTIONAL (policy changed)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User clicks [Update Intent] on hover                                  │
│                           │                                             │
│                           ▼                                             │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Update Intent: Admin-only refunds                               │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │                                                                 │  │
│   │ Current statement:                                              │  │
│   │ "Only users with admin role can process refunds"                │  │
│   │                                                                 │  │
│   │ Updated statement:                                              │  │
│   │ ┌───────────────────────────────────────────────────────────┐  │  │
│   │ │ Only users with admin or support role can process refunds │  │  │
│   │ └───────────────────────────────────────────────────────────┘  │  │
│   │                                                                 │  │
│   │ Reason for change:                                              │  │
│   │ ┌───────────────────────────────────────────────────────────┐  │  │
│   │ │ Support team now handles small refunds per TICKET-123     │  │  │
│   │ └───────────────────────────────────────────────────────────┘  │  │
│   │                                                                 │  │
│   │                                    [Cancel]  [Update Intent]    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   Result:                                                               │
│   - Intent updated in intent-graph.json                                 │
│   - Change reason stored as new evidence                                │
│   - Drift event resolved                                                │
│   - Squiggle disappears                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### MVP Scope

#### In Scope ✅
1. **One intent source**: Local JSON chat export
2. **One attribution source**: Agent Trace JSON files
3. **One language**: TypeScript/JavaScript
4. **One storage**: JSON files in `.intentmesh/`
5. **One LLM**: OpenAI
6. **One UI**: VSCode extension with:
   - Diagnostics (squiggles)
   - Hover (intent + explanation)
   - Simple sidebar (list intents)

#### Out of Scope for MVP ❌
- API-based intent sources (Notion, Linear, etc.)
- Multiple languages
- Database storage
- Architecture drift detection
- Intent evolution workflows
- Team/org features

### MVP User Flow

```
1. User installs extension
2. User runs "IntentMesh: Import Conversation"
   → Picks a JSON chat export file
   → Extension extracts intents via LLM
   → Shows extracted intents for confirmation
   → Saves to .intentmesh/intent-graph.json

3. User edits a file that was AI-generated
4. User saves
   → Extension reads Agent Trace for that file
   → Finds attribution spans (which model, which conversation)
   → Matches conversation URL to intent sources
   → Runs LLM check: "Does this code still match these intents?"
   → Creates DriftEvents for violations

5. User sees squiggles on violating code
6. User hovers → sees:
   - "Violates: Only admins can refund"
   - "From conversation: [link]"
   - "Explanation: This endpoint allows any authenticated user..."
```

### MVP File Structure

```
intentmesh/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts                 # VSCode entry point
│   │
│   ├── container.ts                 # Simple DI
│   ├── config.ts                    # Settings/configuration
│   │
│   ├── core/                        # Interfaces (stable)
│   │   ├── intent-source.ts
│   │   ├── attribution-source.ts
│   │   ├── code-analyzer.ts
│   │   ├── llm-provider.ts
│   │   ├── store.ts
│   │   └── analysis-engine.ts
│   │
│   ├── models/                      # Shared types
│   │   ├── intent.ts
│   │   ├── attribution.ts
│   │   ├── drift.ts
│   │   └── code-element.ts
│   │
│   ├── sources/                     # Intent source implementations
│   │   ├── intent/
│   │   │   ├── local-json-chat.ts   # MVP ✅
│   │   │   ├── local-markdown-spec.ts
│   │   │   └── index.ts
│   │   └── attribution/
│   │       ├── agent-trace-file.ts  # MVP ✅
│   │       └── index.ts
│   │
│   ├── analysis/                    # Code analysis implementations
│   │   ├── typescript-analyzer.ts   # MVP ✅
│   │   └── index.ts
│   │
│   ├── llm/                         # LLM layer (LangChain)
│   │   ├── llm-service.ts           # LangChainLLMService impl
│   │   ├── schemas.ts               # Zod schemas for structured output
│   │   ├── prompts/
│   │   │   ├── extract-intents.ts
│   │   │   └── detect-drift.ts
│   │   └── index.ts
│   │
│   ├── storage/                     # Storage implementations
│   │   ├── json-file-store.ts       # MVP ✅
│   │   └── index.ts
│   │
│   ├── engine/                      # Analysis engine
│   │   ├── analysis-engine.ts
│   │   ├── intent-linker.ts
│   │   └── drift-detector.ts
│   │
│   ├── services/                    # Orchestration
│   │   └── intent-mesh-service.ts
│   │
│   └── ui/                          # VSCode UI
│       ├── diagnostics.ts           # MVP ✅
│       ├── hover-provider.ts        # MVP ✅
│       ├── sidebar/
│       │   └── tree-provider.ts     # MVP ✅
│       ├── commands.ts
│       └── decorations.ts
│
├── test/
│   ├── fixtures/
│   │   ├── sample-chat.json
│   │   ├── sample-trace.json
│   │   └── sample-code/
│   └── ...
│
└── .intentmesh/                     # Workspace data (gitignored or not)
    ├── intent-graph.json
    ├── links.json
    └── cache/
```

---

## Roadmap

### Phase 1: MVP (Weeks 1-3)
- [ ] Core interfaces defined
- [ ] JSON chat source + intent extraction
- [ ] Agent Trace file source
- [ ] TypeScript analyzer (basic)
- [ ] OpenAI provider
- [ ] JSON file store
- [ ] Drift detection engine
- [ ] VSCode: diagnostics + hover + sidebar

### Phase 2: Polish & Robustness (Weeks 4-6)
- [ ] Markdown spec source
- [ ] Better intent linking (semantic search)
- [ ] Caching layer
- [ ] Error handling & recovery
- [ ] Settings UI
- [ ] Telemetry (opt-in)

### Phase 3: More Sources (Weeks 7-10)
- [ ] Cursor thread API source
- [ ] Amp thread API source
- [ ] Notion source
- [ ] Linear/Jira source
- [ ] Python analyzer

### Phase 4: Production Features (Weeks 11-16)
- [ ] SQLite storage
- [ ] Architecture drift detection
- [ ] Intent evolution workflow
- [ ] PR/CI integration (GitHub Action)
- [ ] Multi-repo support

### Phase 5: Team/Enterprise (Weeks 17-20)
- [ ] Cloud storage & sync
- [ ] Team intent sharing
- [ ] Analytics dashboard
- [ ] Policy enforcement
- [ ] SSO/auth
