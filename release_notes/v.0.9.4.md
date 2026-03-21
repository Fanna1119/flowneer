# v0.9.4

## New plugin: `withManualStepping`

Adds manual step-by-step execution to any flow. After calling `flow.run()`, execution suspends before each matched step and waits for `flow.stepper.continue()`. The flow runs in-flight — no serialisation, replay, or process restart is involved.

This is distinct from `resumeFrom` (which replays from a checkpoint in a new run) and `InterruptError` (which aborts the run entirely). `withManualStepping` keeps the live async call stack suspended until you explicitly advance it.

### Import

```typescript
import { withManualStepping } from "flowneer/plugins/persistence";
import type {
  StepperController,
  ManualSteppingOptions,
  StepperStatus,
} from "flowneer/plugins/persistence";
```

### Setup

```typescript
const AppFlow = FlowBuilder.extend([withManualStepping]);
```

### Basic usage

```typescript
const flow = new AppFlow<State>()
  .withManualStepping()
  .then(fetchData, { label: "fetch" })
  .then(callLlm, { label: "llm:generate" })
  .then(save, { label: "save" });

const done = flow.run(shared);

// Loop until the flow finishes
let meta: StepMeta | null;
while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
  console.log("paused at:", meta.label);
  await flow.stepper.continue(); // resolves when the step body finishes
}

await done;
```

### `withManualStepping(options?)`

| Option    | Type                                                   | Description                                                                           |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `filter`  | `StepFilter`                                           | Only pause on matching steps; others run freely. Supports label globs and predicates. |
| `onPause` | `(meta: StepMeta, shared: S) => void \| Promise<void>` | Called each time the flow pauses, before the gate blocks.                             |

### `flow.stepper` — `StepperController<S>`

| Member              | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `status`            | `"idle" \| "paused" \| "running" \| "done"`                                                         |
| `pausedAt`          | `StepMeta` of the currently paused step, or `undefined`.                                            |
| `continue()`        | Release the paused step and run it. Resolves when the step body finishes. Throws if not `"paused"`. |
| `waitUntilPaused()` | Resolves with `StepMeta` on next pause, or `null` when the flow is done.                            |

### Filter — pause only on specific steps

```typescript
// Only pause on "llm:*" steps; all others execute immediately
const flow = new AppFlow<State>()
  .withManualStepping({ filter: ["llm:*"] })
  .then(loadContext, { label: "load" }) // runs freely
  .then(callLlm, { label: "llm:generate" }) // pauses
  .then(saveResult, { label: "save" }); // runs freely
```

### Graph plugin compatibility

`wrapStep` is called per node inside the DAG handler, so the pause gate fires once per graph node in topological order.

```typescript
const GraphManualFlow = FlowBuilder.extend([withGraph, withManualStepping]);

const flow = new GraphManualFlow<State>()
  .withManualStepping()
  .addNode("fetch", fetchFn)
  .addNode("process", processFn)
  .addNode("save", saveFn)
  .addEdge("fetch", "process")
  .addEdge("process", "save")
  .compile();
```

### `JsonFlowBuilder` compatibility

Pass the extended class as `FlowClass`, then call `.withManualStepping()` on the result.

```typescript
const ManualJsonFlow = FlowBuilder.extend([withManualStepping]);

const flow = JsonFlowBuilder.build<State>(config, registry, ManualJsonFlow as any)
  as InstanceType<typeof ManualJsonFlow>;

flow.withManualStepping({ filter: ["llm:*"] });
```

### Error handling

`continue()` resolves regardless of whether the step body threw. Errors propagate through `flow.run()` as normal.

### Composing with `withCheckpoint`

```typescript
const AppFlow = FlowBuilder.extend([withCheckpoint, withManualStepping]);

const flow = new AppFlow<State>()
  .withCheckpoint({ save: (snap, meta) => db.save(snap, meta) })
  .withManualStepping({ filter: ["llm:*"] });
```

---

See the full documentation at [`docs/plugins/persistence/manual-stepping.md`](../docs/plugins/persistence/manual-stepping.md) and the runnable example at [`examples/plugins/manualSteppingExample.ts`](../examples/plugins/manualSteppingExample.ts).

---

## New plugin: `withPerfAnalyzer`

Per-step heap, CPU, and GC profiling using only Node.js built-in performance APIs — zero external dependencies. Wraps each step body with `performance.now()`, `process.cpuUsage()`, `process.memoryUsage()`, and a `PerformanceObserver` for GC events. Results are written to `shared.__perfStats` (per step, in execution order) and `shared.__perfReport` (flow summary) after the flow completes.

### Import

```typescript
import { withPerfAnalyzer } from "flowneer/plugins/dev";
import type {
  StepPerfStats,
  PerfReport,
  PerfAnalyzerOptions,
} from "flowneer/plugins/dev";
```

### Setup

```typescript
const AppFlow = FlowBuilder.extend([withPerfAnalyzer]);
```

### Basic usage

```typescript
const flow = new AppFlow<State>()
  .withPerfAnalyzer({
    onReport: (r) => console.log(JSON.stringify(r, null, 2)),
  })
  .then(fetchData, { label: "fetch" })
  .then(callLlm, { label: "llm:generate" })
  .then(saveResult, { label: "save" });

await flow.run(shared);

console.log(shared.__perfReport.slowest?.label); // "llm:generate"
console.log(shared.__perfReport.peakHeapUsedBytes); // e.g. 18874368
```

### `withPerfAnalyzer(options?, filter?)`

| Parameter | Type                  | Description                                                                                           |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `options` | `PerfAnalyzerOptions` | Profiling options (see below).                                                                        |
| `filter`  | `StepFilter`          | Only profile matching steps; others run without instrumentation. Supports label globs and predicates. |

#### `PerfAnalyzerOptions`

| Option     | Type                           | Default | Description                                                                                     |
| ---------- | ------------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `trackGc`  | `boolean`                      | `true`  | Accumulate GC pause events via `PerformanceObserver`. Disabled gracefully on non-Node runtimes. |
| `onReport` | `(report: PerfReport) => void` | —       | Called with the final `PerfReport` in `afterFlow`.                                              |

### `StepPerfStats` — per-step snapshot

| Field                      | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `durationMs`               | Wall-clock duration (high-res via `performance.now()`).                         |
| `cpuUserMs`                | User-space CPU time consumed during this step (ms).                             |
| `cpuSystemMs`              | Kernel CPU time consumed during this step (ms).                                 |
| `heapDeltaBytes`           | Net change in V8 heap (positive = allocated, negative = freed by GC).           |
| `rssDeltaBytes`            | Net change in Resident Set Size (bytes).                                        |
| `gcCount` / `gcDurationMs` | GC events and pause time attributed to this step. Best-effort (async observer). |
| `threw`                    | `true` if the step threw; stats are still recorded via `finally`.               |

### `PerfReport` — flow summary

| Field               | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| `totalDurationMs`   | Sum of all step `durationMs`.                                        |
| `totalGcDurationMs` | Authoritative total GC pause time for the whole flow.                |
| `peakHeapUsedBytes` | Highest `heapUsedAfter` seen across all steps.                       |
| `slowest`           | `StepPerfStats` for the longest-running step, or `null`.             |
| `heaviest`          | `StepPerfStats` for the step with the largest heap delta, or `null`. |
| `steps`             | All per-step stats in execution order.                               |

### Filter — profile only specific steps

```typescript
// Profile only LLM steps
flow.withPerfAnalyzer({}, ["llm:*"]);
```

### State keys (`AugmentedState`)

```typescript
interface AugmentedState {
  __perfStats?: StepPerfStats[];
  __perfReport?: PerfReport;
}
```

---

See the full documentation at [`docs/plugins/dev/perf-analyzer.md`](../docs/plugins/dev/perf-analyzer.md).

---

## New: `AugmentedState` — automatic plugin state typing

Every plugin-provided `__*` key is now reflected on a single exported interface, `AugmentedState`. Extend your state type with it and TypeScript will type all plugin keys for you — no more manual `__cost?`, `__history?`, `__tools?`, etc.

### Import

```typescript
import type { AugmentedState } from "flowneer";
```

### Usage

```typescript
interface MyState extends AugmentedState {
  topic: string;
  results: string[];
}
```

That's it. All plugin keys are now available with full types and JSDoc on `MyState`.

### Before / after

```typescript
// Before — every plugin key had to be declared manually
interface MyState {
  topic: string;
  results: string[];
  __cost?: number;
  __stepCost?: number;
  __history?: Array<...>;
  __timings?: Record<number, number>;
  __tools?: ToolRegistry;
  __memory?: Memory;
  __llmOutput?: string;
  __structuredOutput?: unknown;
  __validationError?: { message: string; raw: unknown; attempts: number };
  __stream?: (chunk: unknown) => void;
  __channels?: Map<string, unknown[]>;
  __fallbackError?: { stepIndex: number; stepType: string; message: string; stack?: string };
  __tryError?: unknown;
  __humanPrompt?: string;
  __humanFeedback?: string;
  __toolResults?: ToolResult[];
  __reactExhausted?: boolean;
}

// After — one line
interface MyState extends AugmentedState {
  topic: string;
  results: string[];
}
```

### How it works

`AugmentedState` is an empty interface in `src/types.ts`. Each plugin file adds its keys to it via TypeScript declaration merging inside its own `declare module "flowneer"` block. When you import a plugin the merge fires automatically — no extra imports or setup required.

### Covered plugins

| Plugin                 | Keys added                                               |
| ---------------------- | -------------------------------------------------------- |
| `withTiming`           | `__timings`                                              |
| `withHistory`          | `__history`                                              |
| `withCostTracker`      | `__cost`, `__stepCost`                                   |
| `withStructuredOutput` | `__llmOutput`, `__structuredOutput`, `__validationError` |
| `withChannels`         | `__channels`                                             |
| `withStream`           | `__stream`                                               |
| `withTools`            | `__tools`                                                |
| `withMemory`           | `__memory`                                               |
| `withFallback`         | `__fallbackError`                                        |
| `withTryCatch`         | `__tryError`                                             |
| `withHumanNode`        | `__humanPrompt`, `__humanFeedback`                       |
| `withReActLoop`        | `__toolResults`, `__reactExhausted`                      |
| `withPerfAnalyzer`     | `__perfStats`, `__perfReport`                            |
