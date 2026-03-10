# Presets

Presets are higher-level, opinionated building blocks that compose Flowneer's core primitives into common patterns. Unlike plugins (which add capabilities to a `FlowBuilder`), presets return a fully wired `FlowBuilder` ready to run.

## When to use presets vs plugins

|                 | Plugins                          | Presets                                 |
| --------------- | -------------------------------- | --------------------------------------- |
| What they are   | Capabilities added to a flow     | Pre-built flow templates                |
| Usage           | `.withTiming()`, `.withMemory()` | `createAgent(...)`, `ragPipeline(...)`  |
| Extension point | `FlowBuilder.extend([...])`      | Call the function, get a `FlowBuilder`  |
| Composable?     | Yes — chain on any flow          | Yes — extend the returned `FlowBuilder` |

All presets return a `FlowBuilder`, so they compose freely with plugins and each other.

## Categories

### Agent

High-level agent patterns — tool-calling agents and multi-agent orchestration topologies.

```typescript
import { createAgent, tool, withReActLoop } from "flowneer/presets/agent";
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
} from "flowneer/presets/agent";
import {
  roundRobinDebate,
  reflexionAgent,
  planAndExecute,
} from "flowneer/presets/agent";
```

- [createAgent & tool()](./agent/create-agent.md)
- [withReActLoop](./agent/react-loop.md)
- [Multi-agent Patterns](./agent/patterns.md)

### Config

Declarative JSON → FlowBuilder compiler.

```typescript
import { JsonFlowBuilder } from "flowneer/presets/config";
```

- [JsonFlowBuilder](./config/overview.md)

### RAG

Retrieval-augmented generation flows.

```typescript
import { ragPipeline, iterativeRag } from "flowneer/presets/rag";
```

- [ragPipeline](./rag/rag-pipeline.md)
- [iterativeRag](./rag/iterative-rag.md)

### Pipeline

General-purpose LLM workflow patterns.

```typescript
import { generateUntilValid, mapReduceLlm } from "flowneer/presets/pipeline";
```

- [generateUntilValid](./pipeline/generate-until-valid.md)
- [mapReduceLlm](./pipeline/map-reduce-llm.md)
