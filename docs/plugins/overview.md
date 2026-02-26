# Plugins Overview

Flowneer ships with 30+ plugins across 10 categories. All plugins follow the same pattern: register once globally with `FlowBuilder.use()`, then call the added method on any `FlowBuilder` instance.

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";

FlowBuilder.use(withTiming);

const flow = new FlowBuilder<MyState>().withTiming().startWith(myStep);
```

## Plugin Categories

| Category           | Plugins                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **LLM**            | `withCostTracker`, `withRateLimit`, `withStructuredOutput`, `withTokenBudget`                                          |
| **Memory**         | `withMemory`, `BufferWindowMemory`, `KVMemory`, `SummaryMemory`                                                        |
| **Observability**  | `withCallbacks`, `withHistory`, `withInterrupts`, `withTiming`, `withVerbose`                                          |
| **Persistence**    | `withCheckpoint`, `withAuditLog`, `withReplay`, `withVersionedCheckpoint`                                              |
| **Resilience**     | `withCircuitBreaker`, `withTimeout`, `withFallback`, `withCycles`                                                      |
| **Dev / Testing**  | `withDryRun`, `withMocks`, `withStepLimit`, `parallelAtomic`                                                           |
| **Agent**          | `withReActLoop`, `humanNode`, `resumeFlow`, `supervisorCrew`, `sequentialCrew`, `hierarchicalCrew`, `roundRobinDebate` |
| **Tools**          | `withTools`, `ToolRegistry`, `executeTool`, `executeTools`                                                             |
| **Messaging**      | `withChannels`, `withStream`, `emit`, `sendTo`, `receiveFrom`                                                          |
| **Output Parsers** | `parseJsonOutput`, `parseListOutput`, `parseRegexOutput`, `parseMarkdownTable`                                         |
| **Telemetry**      | `TelemetryDaemon`, `consoleExporter`                                                                                   |
| **Graph**          | `addNode`, `addEdge`, `compile`                                                                                        |
| **Eval**           | `runEvalSuite`, `exactMatch`, `f1Score`, `retrievalPrecision`                                                          |

## Import Paths

Plugins are bundled under `flowneer/plugins/*`:

```typescript
// LLM
import { withCostTracker } from "flowneer/plugins/llm";
import { withRateLimit } from "flowneer/plugins/llm";

// Memory
import {
  withMemory,
  BufferWindowMemory,
  KVMemory,
  SummaryMemory,
} from "flowneer/plugins/memory";

// Observability
import {
  withCallbacks,
  withHistory,
  withTiming,
  withVerbose,
} from "flowneer/plugins/observability";
import { withInterrupts } from "flowneer/plugins/observability";

// Persistence
import {
  withCheckpoint,
  withAuditLog,
  withReplay,
  withVersionedCheckpoint,
} from "flowneer/plugins/persistence";

// Resilience
import {
  withCircuitBreaker,
  withTimeout,
  withFallback,
  withCycles,
} from "flowneer/plugins/resilience";

// Dev
import { withDryRun, withMocks, withStepLimit } from "flowneer/plugins/dev";
import { withAtomicUpdates } from "flowneer/plugins/dev";

// Agent
import { withReActLoop } from "flowneer/plugins/agent";
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "flowneer/plugins/agent";

// Tools
import {
  withTools,
  ToolRegistry,
  executeTool,
  executeTools,
} from "flowneer/plugins/tools";

// Messaging
import { withChannels, sendTo, receiveFrom } from "flowneer/plugins/messaging";
import { withStream, emit } from "flowneer/plugins/messaging";

// Output
import { parseJsonOutput } from "flowneer/plugins/output";
import { parseListOutput } from "flowneer/plugins/output";
import { parseRegexOutput } from "flowneer/plugins/output";
import { parseMarkdownTable } from "flowneer/plugins/output";

// Telemetry
import { TelemetryDaemon, consoleExporter } from "flowneer/plugins/telemetry";

// Graph
import { withGraph } from "flowneer/plugins/graph";

// Eval
import { runEvalSuite, exactMatch, f1Score } from "flowneer/plugins/eval";
```

## Shared State Conventions

Many plugins use reserved keys on the shared state object. By convention, built-in plugin keys are prefixed with `__` to avoid collisions with application data:

| Key                  | Set by                                         |
| -------------------- | ---------------------------------------------- |
| `__cost`             | `withCostTracker`                              |
| `__stepCost`         | Your step (consumed by `withCostTracker`)      |
| `__llmOutput`        | Your step (consumed by `withStructuredOutput`) |
| `__structuredOutput` | `withStructuredOutput`                         |
| `__validationError`  | `withStructuredOutput` (on failure)            |
| `__memory`           | `withMemory`                                   |
| `__history`          | `withHistory`                                  |
| `__timings`          | `withTiming`                                   |
| `__fallbackError`    | `withFallback`                                 |
| `__tools`            | `withTools`                                    |
| `__channels`         | `withChannels`                                 |
| `__stream`           | `withStream` / `.stream()`                     |
| `__humanPrompt`      | `humanNode`                                    |
| `__toolResults`      | `withReActLoop`                                |
| `__reactOutput`      | `withReActLoop`                                |
| `__reactExhausted`   | `withReActLoop`                                |
| `__batchItem`        | `.batch()` (configurable via `key`)            |
