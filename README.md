# IntentMesh

**The Semantic Linter for the Agent Coding Era**

> AI writes code fast. Who remembers why?  
> Your AI conversation stays local. The bugs it prevents don't.

IntentMesh captures developer intents from AI coding conversations and detects when code drifts from those stated requirements.

## The Problem

- AI generates 1000s of lines of code per day
- Requirements live in ephemeral chat conversations
- When teammates modify AI-generated code, they don't know the original intent
- Silent regressions happen when code drifts from unstated constraints

## The Solution

IntentMesh:
1. **Captures intents** from AI conversations (Cursor, Claude, Amp)
2. **Links them to code** via [agent-trace.dev](https://agent-trace.dev) attribution
3. **Detects drift** when code changes violate stated requirements
4. **Alerts developers** via IDE diagnostics, MCP tools, or CI/CD

## Quick Start

### VS Code Extension

1. Install the extension (F5 from this repo to run in dev mode)
2. Configure your OpenAI API key in settings (`intentmesh.openaiApiKey`)
3. Generate code with Cursor/Claude
4. Run `node out/cli/write-trace.js .` to record attribution
5. Run **"IntentMesh: Analyze Changes"** to capture intents
6. Make changes → IntentMesh alerts you if they violate intents

### MCP Server (Claude Code / Amp)

```bash
# Add to your MCP config
codex mcp add intentmesh --env OPENAI_API_KEY=$OPENAI_API_KEY -- node /path/to/intentmesh/out/mcp-stdio.js /path/to/project
```

## Features

- **Multi-source intents**: AI conversations, PRDs, specs, manual annotations
- **Automatic linking**: Uses git diffs and agent-trace to map intents to code
- **Smart detection**: Only flags clear violations (confidence ≥ 0.9)
- **Multiple outputs**: VS Code diagnostics, MCP server, CLI
- **Pluggable architecture**: Swap LLM providers, storage backends, intent sources

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  AI Conversations│ ──▶ │  Extract Intents │ ──▶ │  Detect Drift   │ ──▶ │  Alert/Block │
│  PRDs & Specs   │     │  (LLM)           │     │  on Changes     │     │  IDE/CI/MCP  │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └──────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `intentmesh.llmProvider` | LLM provider (openai, anthropic, ollama) | `openai` |
| `intentmesh.openaiApiKey` | OpenAI API key | - |
| `intentmesh.llmModel` | Model to use | `gpt-5-mini` |

## Development

```bash
# Install dependencies
npm install

# Build
npm run compile

# Watch mode
npm run watch

# Run extension (press F5 in VS Code)
```

## Project Structure

```
src/
├── core/           # Interfaces & dependency injection
├── models/         # Data types (Intent, Drift, etc.)
├── sources/        # Intent & attribution sources
├── llm/            # LLM service (LangChain)
├── engine/         # Drift detection logic
├── storage/        # JSON file store
├── adapters/       # MCP server adapter
├── ui/             # VS Code UI (diagnostics, sidebar, hover)
└── extension.ts    # VS Code entry point
```

## Documentation

- [Demo Guide](docs/DEMO-GUIDE.md) - End-to-end demo walkthrough
- [Architecture](ARCHITECTURE.md) - Detailed system design

## License

MIT - see [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please read the architecture doc first to understand the design principles.
