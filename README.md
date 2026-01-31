# IntentMesh

A VSCode extension for tracking and analyzing AI agent conversations and code intents.

## Features

- **Import Conversations**: Import agent conversation traces for analysis
- **Analyze Workspace**: Scan your codebase to extract and track intents
- **Intent Tracking**: View and manage intents in the sidebar
- **Drift Detection**: Identify when code drifts from original intents

## Getting Started

1. Install the extension
2. Configure your LLM provider in settings
3. Import conversation traces or analyze your workspace

## Configuration

- `intentmesh.llmProvider`: Choose between OpenAI, Anthropic, or Ollama
- `intentmesh.openaiApiKey`: Your OpenAI API key
- `intentmesh.anthropicApiKey`: Your Anthropic API key
- `intentmesh.agentTracePaths`: Paths to agent trace files

## Development

```bash
npm install
npm run build
```

Press F5 in VSCode to launch the extension in debug mode.
