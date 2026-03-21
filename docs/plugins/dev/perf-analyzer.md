# withPerfAnalyzer

Per-step heap, CPU, and GC profiling using only Node.js built-in performance APIs — zero external dependencies. Records wall-clock duration, CPU time, heap delta, RSS delta, and GC pause stats for every step, then writes a flow-level summary to `shared.__perfReport`.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withPerfAnalyzer } from "flowneer/plugins/dev";

const AppFlow = FlowBuilder.extend([withPerfAnalyzer]);
```

---

## Basic usage

```typescript
const flow = new AppFlow<State>()
  .withPerfAnalyzer({
    onReport: (r) => console.log(JSON.stringify(r, null, 2)),
  })
  .then(fetchData, { label: "fetch" })
  .then(callLlm, { label: "llm:generate" })
  .then(saveResult, { label: "save" });

await flow.run(shared);

// Per-step stats in execution order
console.log(shared.__perfStats);
// [{ label: "fetch", durationMs: 42, heapDeltaBytes: 131072, ... }, ...]

// Flow summary
console.log(shared.__perfReport.slowest?.label); // "llm:generate"
console.log(shared.__perfReport.peakHeapUsedBytes); // 18874368
```

---

## `withPerfAnalyzer(options?, filter?)`

| Parameter | Type                  | Description                                                                                           |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `options` | `PerfAnalyzerOptions` | Profiling options (see below).                                                                        |
| `filter`  | `StepFilter`          | Only profile matching steps; others run without instrumentation. Supports label globs and predicates. |

### `PerfAnalyzerOptions`

| Option     | Type                           | Default | Description                                                                                     |
| ---------- | ------------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `trackGc`  | `boolean`                      | `true`  | Accumulate GC pause events via `PerformanceObserver`. Disabled gracefully on non-Node runtimes. |
| `onReport` | `(report: PerfReport) => void` | —       | Called with the final `PerfReport` in `afterFlow`. Use to log or ship metrics.                  |

---

## `StepPerfStats`

Each entry in `shared.__perfStats[]`:

| Field                | Type      | Description                                                                |
| -------------------- | --------- | -------------------------------------------------------------------------- |
| `index`              | `number`  | Step index (0-based).                                                      |
| `type`               | `string`  | Step type: `"fn"`, `"branch"`, `"loop"`, `"batch"`, `"parallel"`, `"dag"`. |
| `label`              | `string?` | Step label if set via `NodeOptions.label`.                                 |
| `durationMs`         | `number`  | Wall-clock duration (high-res via `performance.now()`).                    |
| `cpuUserMs`          | `number`  | User-space CPU time consumed during this step (ms).                        |
| `cpuSystemMs`        | `number`  | Kernel CPU time consumed during this step (ms).                            |
| `heapUsedBefore`     | `number`  | V8 heap used at step start (bytes).                                        |
| `heapUsedAfter`      | `number`  | V8 heap used at step end (bytes).                                          |
| `heapDeltaBytes`     | `number`  | Net change in V8 heap (positive = allocated, negative = freed by GC).      |
| `rssDeltaBytes`      | `number`  | Net change in Resident Set Size (bytes).                                   |
| `externalDeltaBytes` | `number`  | Net change in external (C++ / Buffer) memory (bytes).                      |
| `gcCount`            | `number`  | GC events attributed to this step. Best-effort (see GC note below).        |
| `gcDurationMs`       | `number`  | Total GC pause duration attributed to this step (ms). Best-effort.         |
| `threw`              | `boolean` | `true` if the step threw (stats still recorded via `finally`).             |

---

## `PerfReport`

Written to `shared.__perfReport` in `afterFlow`:

| Field               | Type                    | Description                                                               |
| ------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `totalDurationMs`   | `number`                | Sum of all step `durationMs` (parallel steps overlap in wall-clock time). |
| `totalCpuUserMs`    | `number`                | Sum of all step `cpuUserMs`.                                              |
| `totalCpuSystemMs`  | `number`                | Sum of all step `cpuSystemMs`.                                            |
| `totalGcDurationMs` | `number`                | Authoritative total GC pause time for the whole flow (ms).                |
| `totalGcCount`      | `number`                | Total GC event count during the flow.                                     |
| `peakHeapUsedBytes` | `number`                | Highest `heapUsedAfter` seen across all steps (bytes).                    |
| `steps`             | `StepPerfStats[]`       | All per-step stats in execution order.                                    |
| `slowest`           | `StepPerfStats \| null` | Step with the longest wall-clock duration, or `null` if no steps ran.     |
| `heaviest`          | `StepPerfStats \| null` | Step with the largest heap delta, or `null` if no steps ran.              |

---

## Filter — profile only specific steps

```typescript
// Only profile LLM steps; all others run without instrumentation
const flow = new AppFlow<State>()
  .withPerfAnalyzer({}, ["llm:*"])
  .then(loadContext, { label: "load" }) // not profiled
  .then(callLlm, { label: "llm:generate" }) // profiled
  .then(callEmbedding, { label: "llm:embed" }) // profiled
  .then(saveResult, { label: "save" }); // not profiled
```

---

## State keys

`withPerfAnalyzer` writes to two keys on `shared`. Extend `AugmentedState` to get them typed automatically:

```typescript
import type { AugmentedState } from "flowneer";

interface MyState extends AugmentedState {
  topic: string;
  results: string[];
}

// shared.__perfStats  → StepPerfStats[]
// shared.__perfReport → PerfReport
```

---

## GC note

`PerformanceObserver` fires asynchronously, so GC events received between two step boundaries are attributed to the step that just ended. This makes per-step `gcCount` / `gcDurationMs` best-effort. Use `__perfReport.totalGcDurationMs` for an authoritative flow-level GC measurement.

GC tracking is silently disabled on runtimes that do not support `PerformanceObserver` (e.g. non-Node environments). Set `trackGc: false` to opt out explicitly.

---

## Graph plugin compatibility

`wrapStep` fires once per graph node in topological order, so every DAG node gets its own `StepPerfStats` entry.

```typescript
const GraphPerfFlow = FlowBuilder.extend([withGraph, withPerfAnalyzer]);

const flow = new GraphPerfFlow<State>()
  .withPerfAnalyzer({ onReport: (r) => console.log(r.slowest) })
  .addNode("fetch", fetchFn)
  .addNode("process", processFn)
  .addNode("save", saveFn)
  .addEdge("fetch", "process")
  .addEdge("process", "save")
  .compile();

await flow.run(shared);
```

---

## Composing with other dev plugins

```typescript
const AppFlow = FlowBuilder.extend([withPerfAnalyzer, withDryRun]);

const flow = new AppFlow<State>()
  .withPerfAnalyzer()
  .withDryRun() // step bodies skipped, but hook overhead is still measured
  .then(fetchData, { label: "fetch" })
  .then(callLlm, { label: "llm:generate" });

await flow.run(shared);
// shared.__perfReport.totalDurationMs → hook overhead only
```
