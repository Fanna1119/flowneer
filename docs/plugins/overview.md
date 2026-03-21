# Plugins Overview

Flowneer ships with a focused set of plugin methods plus a smaller set of helper modules. Plugin methods follow the same pattern: create a subclass with `FlowBuilder.extend([...plugins])`, then call the added methods on any instance of that subclass. Helper utilities such as `createAgent`, crew patterns, and output parsers are imported directly and do not participate in plugin registration.

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";

const AppFlow = FlowBuilder.extend([withTiming]);

const flow = new AppFlow<MyState>().withTiming().startWith(myStep);
```

## Plugin Categories

| Category           | Surface                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **LLM**            | `withCostTracker`, `withRateLimit`, `withStructuredOutput`, `withTokenBudget`                           |
| **Memory**         | `withMemory`, `BufferWindowMemory`, `KVMemory`, `SummaryMemory`                                         |
| **Observability**  | `withCallbacks`, `withHistory`, `withInterrupts`, `withTiming`, `withVerbose`                           |
| **Persistence**    | `withCheckpoint`, `withAuditLog`, `withReplay`, `withVersionedCheckpoint`, `withManualStepping`         |
| **Resilience**     | `withCircuitBreaker`, `withTimeout`, `withFallback`, `withCycles`                                       |
| **Dev / Testing**  | `withDryRun`, `withMocks`, `withStepLimit`, `withAtomicUpdates`, `withFlowAnalyzer`, `withPerfAnalyzer` |
| **Agent plugins**  | `withReActLoop`, `withHumanNode`, `resumeFlow`                                                          |
| **Agent helpers**  | `tool`, `createAgent`, `supervisorCrew`, `sequentialCrew`, `hierarchicalCrew`, `roundRobinDebate`       |
| **Tools**          | `withTools`, `ToolRegistry`, `executeTool`, `executeTools`                                              |
| **Messaging**      | `withChannels`, `withStream`, `emit`, `sendTo`, `receiveFrom`                                           |
| **Output helpers** | `parseJsonOutput`, `parseListOutput`, `parseRegexOutput`, `parseMarkdownTable`                          |
| **Telemetry**      | `withTelemetry`, `TelemetryDaemon`, `consoleExporter`, `otlpExporter`                                   |
| **Graph**          | `withGraph`, `withExportGraph`, `withExportFlow`                                                        |
| **Eval**           | `runEvalSuite`, `exactMatch`, `containsMatch`, `f1Score`, `retrievalPrecision`, `retrievalRecall`       |
| **Compliance**     | `withAuditFlow`, `withRuntimeCompliance`, `scanShared`                                                  |
| **Config**         | `JsonFlowBuilder`, `validate`                                                                           |

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
  withManualStepping,
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

// Agent plugins
import { withReActLoop } from "flowneer/plugins/agent";
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";

// Agent helpers
import { tool, createAgent } from "flowneer/plugins/agent";
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

// Output helpers
import { parseJsonOutput } from "flowneer/plugins/output";
import { parseListOutput } from "flowneer/plugins/output";
import { parseRegexOutput } from "flowneer/plugins/output";
import { parseMarkdownTable } from "flowneer/plugins/output";

// Telemetry
import { TelemetryDaemon, consoleExporter } from "flowneer/plugins/telemetry";

// Graph
import { withGraph } from "flowneer/plugins/graph";
import { withExportGraph, withExportFlow } from "flowneer/plugins/graph";

// Eval
import { runEvalSuite, exactMatch, f1Score } from "flowneer/plugins/eval";

// Compliance
import {
  withAuditFlow,
  withRuntimeCompliance,
  scanShared,
} from "flowneer/plugins/compliance";

// Dev — analysis
import { withFlowAnalyzer } from "flowneer/plugins/dev";
import { withPerfAnalyzer } from "flowneer/plugins/dev";
import type {
  StepPerfStats,
  PerfReport,
  PerfAnalyzerOptions,
} from "flowneer/plugins/dev";

// Config
import { JsonFlowBuilder } from "flowneer/plugins/config";
```

## Shared State Conventions

Many plugins use reserved keys on the shared state object. By convention, built-in plugin keys are prefixed with `__` to avoid collisions with application data.

### `AugmentedState` — automatic typing

All plugin-provided `__*` keys are declared on the exported `AugmentedState` interface via TypeScript declaration merging. Extend your state with it to get every key typed and documented automatically:

```typescript
import type { AugmentedState } from "flowneer";

interface MyState extends AugmentedState {
  topic: string; // your domain fields
  results: string[];
  // __cost, __history, __tools … all typed automatically
}
```

No additional imports or setup are needed. Augmentations are applied per-plugin when the plugin module is imported.

### Key reference

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
| `__tryError`         | `withTryCatch`                                 |
| `__tools`            | `withTools`                                    |
| `__channels`         | `withChannels`                                 |
| `__stream`           | `withStream` / `.stream()`                     |
| `__humanPrompt`      | `withHumanNode`                                |
| `__humanFeedback`    | Written by caller before `resumeFlow()`        |
| `__toolResults`      | `withReActLoop`                                |
| `__reactExhausted`   | `withReActLoop`                                |
| `__batchItem`        | `.batch()` (configurable via `key`)            |
| `__perfStats`        | `withPerfAnalyzer` (per-step stats array)      |
| `__perfReport`       | `withPerfAnalyzer` (flow-level summary)        |
