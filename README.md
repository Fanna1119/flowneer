<div align="center">
    <img src="https://github.com/Fanna1119/flowneer/blob/main/docs/public/flowneer_logo.png" width="500" height="auto" alt="Flowneer"/>
</div>

<p>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://img.shields.io/npm/v/flowneer" /></a>
  <a href="https://deno.bundlejs.com/badge?q=flowneer"><img src="https://deno.bundlejs.com/badge?q=flowneer" /></a>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://img.shields.io/npm/l/flowneer" /></a>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://img.shields.io/npm/d18m/flowneer" /></a>
  <a href="https://deepwiki.com/Fanna1119/flowneer"><img src="https://deepwiki.com/badge.svg" /></a>
  <a href="https://github.com/Fanna1119/flowneer"><img src="https://img.shields.io/badge/GitHub-%23121011.svg?logo=github&logoColor=white)" /></a>
  <a href="https://context7.com/fanna1119/flowneer"><img src="https://img.shields.io/badge/-Context7-black?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzA1OTY2OSIvPgo8cGF0aCBkPSJNMTAuNTcyNCAxNS4yNTY1QzEwLjU3MjQgMTcuNTAyNSA5LjY2MTMgMTkuMzc3OCA4LjE3ODA1IDIxLjEwNDdIMTEuNjMxOUwxMS42MzE5IDIyLjc3ODZINi4zMzQ1OVYyMS4xODk1QzcuOTU1NTcgMTkuMzU2NiA4LjU4MDY1IDE3Ljg2MjggOC41ODA2NSAxNS4yNTY1TDEwLjU3MjQgMTUuMjU2NVoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0xNy40Mjc2IDE1LjI1NjVDMTcuNDI3NiAxNy41MDI1IDE4LjMzODcgMTkuMzc3OCAxOS44MjIgMjEuMTA0N0gxNi4zNjgxVjIyLjc3ODZIMjEuNjY1NFYyMS4xODk1QzIwLjA0NDQgMTkuMzU2NiAxOS40MTk0IDE3Ljg2MjggMTkuNDE5NCAxNS4yNTY1SDE3LjQyNzZaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMTAuNTcyNCAxMi43NDM1QzEwLjU3MjQgMTAuNDk3NSA5LjY2MTMxIDguNjIyMjQgOC4xNzgwNyA2Ljg5NTMyTDExLjYzMTkgNi44OTUzMlY1LjIyMTM3TDYuMzM0NjEgNS4yMjEzN1Y2LjgxMDU2QzcuOTU1NTggOC42NDM0MyA4LjU4MDY2IDEwLjEzNzMgOC41ODA2NiAxMi43NDM1TDEwLjU3MjQgMTIuNzQzNVoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0xNy40Mjc2IDEyLjc0MzVDMTcuNDI3NiAxMC40OTc1IDE4LjMzODcgOC42MjIyNCAxOS44MjIgNi44OTUzMkwxNi4zNjgxIDYuODk1MzJMMTYuMzY4MSA1LjIyMTM4TDIxLjY2NTQgNS4yMjEzOFY2LjgxMDU2QzIwLjA0NDQgOC42NDM0MyAxOS40MTk0IDEwLjEzNzMgMTkuNDE5NCAxMi43NDM1SDE3LjQyNzZaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K" alt="Badge"></a>
</p>

**Flowneer** is a tiny (~3 kB gzipped), zero-dependency TypeScript flow builder that gives you full control over deterministic, stateful LLM agents and workflows.

### Why Flowneer?

- **Ultra-lightweight** — ~3 kB gzipped core, zero dependencies
- **Fluent & composable** — Chain steps with shared mutable state
- **Full control flow primitives** — `.startWith()`, `.then()`, `.branch()`, `.loop()`, `.parallel()`, `.batch()`, `.anchor()` jumps
- **Streaming-first** — Real-time `.stream()` with event/chunk yielding
- **Precise extensibility** — Subclass with `.extend([plugins])` and scope hooks/plugins exactly where needed (via `StepFilter` globs/predicates)
- **Production-ready patterns** — Built-in presets for ReAct, sequential crews, supervisor-workers, round-robin debate, refinement loops

### Plugins unlock what you actually need

- Tool calling & registries
- ReAct / reasoning loops
- Memory (buffer, summary, KV)
- Human-in-the-loop interrupts
- Structured output parsing
- Rate limiting, retries, timeouts, tracing, eval, graph export/import

No forced abstractions. No monolith. Just a fast, deterministic builder that stays out of your way while giving you structured concurrency, cancellation, observability, and agentic power.

> Flowneer is currently under heavy development with ongoing pattern exploration and architectural refinement. Breaking changes are expected frequently, potentially on a daily basis, as the core design is actively evolving.

## Install

```bash
bun add flowneer
```

## For LLM Agents

[llms.txt](https://fanna1119.github.io/flowneer/llms.txt)
[llms-full.txt](https://fanna1119.github.io/flowneer/llms-full.txt)

## Quick start

```typescript
import { FlowBuilder } from "flowneer";

interface State {
  count: number;
}

await new FlowBuilder<State>()
  .startWith(async (s) => {
    s.count = 0;
  })
  .then(async (s) => {
    s.count += 1;
  })
  .then(async (s) => {
    console.log(s.count);
  }) // 1
  .run({ count: 0 });
```

Every step receives a **shared state object** (`s`) that you mutate directly. That's the whole data model.

---

## API

### `startWith(fn, options?)`

Set the first step, resetting any prior chain.

### `then(fn, options?)`

Append a sequential step.

### `branch(router, branches, options?)`

Route to a named branch based on the return value of `router`.

```typescript
await new FlowBuilder<{ role: string; message: string }>()
  .startWith(async (s) => {
    s.role = "admin";
  })
  .branch((s) => s.role, {
    admin: async (s) => {
      s.message = "Welcome, admin!";
    },
    guest: async (s) => {
      s.message = "Limited access.";
    },
  })
  .then(async (s) => console.log(s.message))
  .run({ role: "", message: "" });
// -> Welcome, admin!
```

### `loop(condition, body)`

Repeat a sub-flow while `condition` returns `true`.

```typescript
await new FlowBuilder<{ ticks: number }>()
  .startWith(async (s) => {
    s.ticks = 0;
  })
  .loop(
    (s) => s.ticks < 3,
    (b) =>
      b.startWith(async (s) => {
        s.ticks += 1;
      }),
  )
  .then(async (s) => console.log("done, ticks =", s.ticks))
  .run({ ticks: 0 });
// -> done, ticks = 3
```

### `batch(items, processor, options?)`

Run a sub-flow once per item. The current item is written to `shared.__batchItem` by default. Pass a `{ key }` option to name the item slot — required for nested batches.

```typescript
await new FlowBuilder<{
  numbers: number[];
  results: number[];
  __batchItem?: number;
}>()
  .startWith(async (s) => {
    s.results = [];
  })
  .batch(
    (s) => s.numbers,
    (b) =>
      b.startWith(async (s) => {
        s.results.push((s.__batchItem ?? 0) * 2);
      }),
  )
  .then(async (s) => console.log(s.results))
  .run({ numbers: [1, 2, 3], results: [] });
// -> [2, 4, 6]
```

### `parallel(fns, options?, reducer?)`

Run multiple functions concurrently against the same shared state. When a `reducer` is provided, each fn receives its own shallow clone and the reducer merges results back.

```typescript
await new FlowBuilder<{ posts?: any[]; users?: any[] }>()
  .parallel([
    async (s) => {
      s.posts = await fetch("/posts").then((r) => r.json());
    },
    async (s) => {
      s.users = await fetch("/users").then((r) => r.json());
    },
  ])
  .then(async (s) => console.log(s.posts?.length, s.users?.length))
  .run({});
```

### `anchor(name)`

Insert a named marker in the step chain. Any `NodeFn` can return `"#anchorName"` to jump to that anchor, enabling iterative refinement loops without nesting.

```typescript
await new FlowBuilder<{ draft: string; quality: number; passes: number }>()
  .startWith(async (s) => {
    s.draft = await generateDraft(s);
  })
  .anchor("refine")
  .then(async (s) => {
    s.quality = await scoreDraft(s.draft);
    if (s.quality < 0.8) {
      s.draft = await improveDraft(s.draft);
      s.passes++;
      return "#refine";
    }
  })
  .then(async (s) => console.log("Final draft after", s.passes, "passes"))
  .run({ draft: "", quality: 0, passes: 0 });
```

> Pair with [`withCycles`](#resilience) to cap the maximum number of jumps.

### `fragment()` and `.add(fragment)`

Fragments are reusable partial flows that can be spliced into any `FlowBuilder`.

```typescript
import { FlowBuilder, fragment } from "flowneer";

const enrich = fragment<State>()
  .then(async (s) => {
    s.enriched = true;
  })
  .then(async (s) => {
    s.input = s.input.trim();
  });

await new FlowBuilder<State>()
  .startWith(async (s) => {
    s.input = "  hello  ";
  })
  .add(enrich)
  .then(async (s) => console.log(s.input))
  .run({ input: "", enriched: false, summary: "" });
```

Fragments support all step types. They cannot be run directly — calling `.run()` on a fragment throws.

### `run(shared, params?, options?)`

Execute the flow. Optionally pass a `params` object that every step receives as a second argument, and an `AbortSignal` to cancel between steps.

```typescript
await flow.run(shared);
await flow.run(shared, { userId: "123" });

const controller = new AbortController();
await flow.run(shared, undefined, { signal: controller.signal });
```

### `stream(shared, params?, options?)`

An async-generator alternative to `run()` that yields `StreamEvent` values as the flow executes.

```typescript
for await (const event of flow.stream(shared)) {
  if (event.type === "step:before") console.log("->", event.meta.index);
  if (event.type === "chunk") process.stdout.write(event.chunk as string);
  if (event.type === "done") break;
}
```

Steps emit chunks by assigning to `shared.__stream`:

```typescript
.then(async (s) => {
  for await (const token of llmStream()) {
    s.__stream = token; // -> yields { type: "chunk", chunk: token }
  }
})
```

| Event type    | Extra fields     | When emitted                            |
| ------------- | ---------------- | --------------------------------------- |
| `step:before` | `meta`           | Before each step                        |
| `step:after`  | `meta`, `shared` | After each step completes               |
| `chunk`       | `meta`, `chunk`  | When a step writes to `shared.__stream` |
| `error`       | `meta`, `error`  | When a step throws                      |
| `done`        | `shared`         | After the flow finishes                 |

### Step options

Any step that accepts `options` supports:

| Option      | Default | Description                                            |
| ----------- | ------- | ------------------------------------------------------ |
| `retries`   | `1`     | Number of attempts before throwing                     |
| `delaySec`  | `0`     | Seconds to wait between retries                        |
| `timeoutMs` | `0`     | Milliseconds before the step is aborted (0 = no limit) |

---

## Error handling

When a step throws, the error is wrapped in a `FlowError` with the step index and type:

```typescript
import { FlowBuilder, FlowError } from "flowneer";

try {
  await new FlowBuilder()
    .startWith(async () => {})
    .then(async () => {
      throw new Error("boom");
    })
    .run({});
} catch (err) {
  if (err instanceof FlowError) {
    console.log(err.step); // "step 1"
    console.log(err.cause); // Error: boom
  }
}
```

`InterruptError` is a special error that bypasses `FlowError` wrapping and propagates directly to the caller. Use it for human-in-the-loop patterns via [`withInterrupts`](#observability) or [`withHumanNode`](#agent).

---

## Plugins

The core is intentionally small. Use `FlowBuilder.extend([...plugins])` to create a subclass with plugins mixed in. Unlike the removed `use()`, `extend()` never mutates the base class — each call returns an isolated subclass.

### Using a plugin

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";
import { withRateLimit } from "flowneer/plugins/llm";

const AppFlow = FlowBuilder.extend([withTiming, withRateLimit]);

const flow = new AppFlow<State>()
  .withTiming()
  .withRateLimit({ intervalMs: 500 })
  .startWith(step1)
  .then(step2);
```

Chain `extend()` calls to layer plugins on top of a base subclass:

```typescript
const BaseFlow = FlowBuilder.extend([withTiming]);
const TracedFlow = BaseFlow.extend([withTrace]); // has both plugins
```

### Writing a plugin

A plugin is an object of functions that get mixed onto `FlowBuilder.prototype`. Each function receives the builder as `this` and should return `this` for chaining.

```typescript
import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "flowneer";

declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withTracing(
      fn: (meta: StepMeta, event: string) => void,
      filter?: StepFilter,
    ): this;
  }
}

export const tracingPlugin: FlowneerPlugin = {
  withTracing(this: FlowBuilder<any, any>, fn, filter?: StepFilter) {
    (this as any)._setHooks(
      {
        beforeStep: (meta: StepMeta) => fn(meta, "before"),
        afterStep: (meta: StepMeta) => fn(meta, "after"),
        onError: (meta: StepMeta) => fn(meta, "error"),
      },
      filter,
    );
    return this;
  },
};
```

### Lifecycle hooks

Plugins register hooks via `_setHooks()`. Multiple registrations of the same hook compose — the first registered is the outermost.

| Hook             | Called                                                    | Arguments                               |
| ---------------- | --------------------------------------------------------- | --------------------------------------- |
| `beforeFlow`     | Once before the first step                                | `(shared, params)`                      |
| `beforeStep`     | Before each step executes                                 | `(meta, shared, params)`                |
| `wrapStep`       | Wraps step execution — call `next()` to run the step body | `(meta, next, shared, params)`          |
| `afterStep`      | After each step completes                                 | `(meta, shared, params)`                |
| `wrapParallelFn` | Wraps each individual fn inside a `parallel()` step       | `(meta, fnIndex, next, shared, params)` |
| `onError`        | When a step throws (before re-throwing)                   | `(meta, error, shared, params)`         |
| `afterFlow`      | After the flow finishes (success or failure)              | `(shared, params)`                      |

Step-scoped hooks (`beforeStep`, `afterStep`, `onError`, `wrapStep`, `wrapParallelFn`) accept an optional [`StepFilter`](#stepfilter) as the second argument to `_setHooks()`. `beforeFlow` / `afterFlow` are unaffected. Unmatched `wrapStep`/`wrapParallelFn` hooks always call `next()` automatically so the middleware chain is never broken.

### `StepFilter`

```typescript
type StepFilter = string[] | ((meta: StepMeta) => boolean);
```

- **String array** — matches steps by `label`. Supports `*` as a glob wildcard (`"llm:*"` matches `"llm:summarise"`, `"llm:embed"`, …). Steps without a label are never matched.
- **Predicate** — return `true` to match. Use this for runtime conditions or multi-criteria logic.

```typescript
// Array form with glob
flow.addHooks({ beforeStep: log }, ["llm:*", "embed:*"]);

// Predicate form
flow.addHooks(
  { beforeStep: log },
  (meta) => meta.label?.startsWith("llm:") ?? false,
);
```

`addHooks(hooks, filter?)` returns a `dispose()` function to remove the hooks.

---

## Available plugins

All plugins are imported from `flowneer/plugins` or their individual subpath (e.g. `flowneer/plugins/resilience`).

### Observability

| Plugin           | Method                     | Description                                                                                        |
| ---------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `withHistory`    | `.withHistory()`           | Appends a shallow state snapshot after each step to `shared.__history`                             |
| `withTiming`     | `.withTiming()`            | Records wall-clock duration (ms) of each step in `shared.__timings[index]`                         |
| `withVerbose`    | `.withVerbose()`           | Prints the full `shared` object to stdout after each step                                          |
| `withInterrupts` | `.interruptIf(condition)`  | Throws an `InterruptError` (with a deep-clone of `shared`) when `condition` is true                |
| `withCallbacks`  | `.withCallbacks(handlers)` | LangChain-style lifecycle callbacks dispatched by step label prefix (`llm:*`, `tool:*`, `agent:*`) |

### Persistence

| Plugin                    | Method                            | Description                                                                                         |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `withCheckpoint`          | `.withCheckpoint(store)`          | Saves `shared` to a store after each successful step                                                |
| `withAuditLog`            | `.withAuditLog(store)`            | Writes an immutable deep-clone audit entry to a store after every step (success and error)          |
| `withReplay`              | `.withReplay(fromStep)`           | Skips all steps before `fromStep`; combine with `.withCheckpoint()` to resume a failed flow         |
| `withVersionedCheckpoint` | `.withVersionedCheckpoint(store)` | Diff-based versioned checkpoints with parent pointers; use `.resumeFrom(version, store)` to restore |

### Resilience

| Plugin               | Method                       | Description                                                                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `withCircuitBreaker` | `.withCircuitBreaker(opts?)` | Opens the circuit after `maxFailures` consecutive failures and rejects all steps until `resetMs` elapses      |
| `withFallback`       | `.withFallback(fn)`          | Catches any step error and calls `fn` instead of propagating                                                  |
| `withTimeout`        | `.withTimeout(ms)`           | Aborts any step that exceeds `ms` milliseconds                                                                |
| `withCycles`         | `.withCycles(n, anchor?)`    | Throws after `n` anchor jumps globally, or after `n` visits to a named anchor — guards against infinite loops |

### Messaging

| Plugin         | Method            | Description                                                                                             |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `withChannels` | `.withChannels()` | `Map`-based message-channel system on `shared.__channels`; use `sendTo` / `receiveFrom` / `peekChannel` |
| `withStream`   | `.withStream()`   | Enables real-time chunk streaming via `shared.__stream`                                                 |

### LLM

| Plugin                 | Method                           | Description                                                              |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `withCostTracker`      | `.withCostTracker()`             | Accumulates per-step `shared.__stepCost` values into `shared.__cost`     |
| `withRateLimit`        | `.withRateLimit({ intervalMs })` | Enforces a minimum gap of `intervalMs` ms between steps                  |
| `withTokenBudget`      | `.withTokenBudget(limit)`        | Aborts the flow before any step where `shared.tokensUsed >= limit`       |
| `withStructuredOutput` | `.withStructuredOutput(opts)`    | Parses and validates `shared.__llmOutput` via a Zod-compatible validator |

### Tools

| Plugin      | Method                 | Description                                                                               |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `withTools` | `.withTools(registry)` | Attaches a `ToolRegistry` to `shared.__tools`; use `executeTool` / `executeTools` helpers |

### Agent

| Plugin          | Method                 | Description                                                                                               |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `withReActLoop` | `.withReActLoop(opts)` | Built-in ReAct loop: think -> tool-call -> observe, with configurable `maxIterations` and `onObservation` |
| `withHumanNode` | `.humanNode(opts?)`    | Inserts a human-in-the-loop pause; pair with `resumeFlow()` to continue after receiving input             |

### Memory

| Plugin       | Method                  | Description                                                                                                    |
| ------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `withMemory` | `.withMemory(instance)` | Attaches a `Memory` instance to `shared.__memory`; choose `BufferWindowMemory`, `SummaryMemory`, or `KVMemory` |

### Output

Pure parsing helpers — no plugin registration needed. Import from `flowneer/plugins/output`.

| Function             | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `parseJsonOutput`    | Parse raw JSON, fenced, or embedded JSON from LLM text        |
| `parseListOutput`    | Parse dash, `*`, bullet, numbered, or newline-separated lists |
| `parseMarkdownTable` | Parse GFM tables to `Record<string, string>[]`                |
| `parseRegexOutput`   | Extract named or positional regex capture groups              |

### Eval

| Export                                   | Description                                                       |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `runEvalSuite`                           | Run a flow against a labelled dataset and collect per-item scores |
| `exactMatch`                             | Scorer: exact string equality                                     |
| `containsMatch`                          | Scorer: substring containment                                     |
| `f1Score`                                | Scorer: token-level F1                                            |
| `retrievalPrecision` / `retrievalRecall` | Scorer: retrieval quality metrics                                 |
| `answerRelevance`                        | Scorer: relevance signal                                          |

### Graph

| Plugin      | Method         | Description                                                                                                  |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `withGraph` | `.withGraph()` | Describe a flow as a DAG with `.addNode()` / `.addEdge()`, then `.compile()` to a ready-to-run `FlowBuilder` |

### Telemetry

| Plugin          | Method                  | Description                                                                                                      |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `withTelemetry` | `.withTelemetry(opts?)` | Structured span telemetry via `TelemetryDaemon`; accepts `consoleExporter`, `otlpExporter`, or a custom exporter |

### Dev

| Plugin              | Method                                    | Description                                                                                 |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `withDryRun`        | `.withDryRun()`                           | Skips all step bodies while still firing hooks — useful for validating observability wiring |
| `withMocks`         | `.withMocks(map)`                         | Replaces step bodies at specified indices with mock functions                               |
| `withStepLimit`     | `.withStepLimit(max?)`                    | Throws after `max` total step executions (default 1000)                                     |
| `withAtomicUpdates` | `.parallelAtomic(fns, reducer, options?)` | Sugar over `parallel()` with a reducer — each fn runs on an isolated draft                  |

---

## Presets

Presets are ready-made `FlowBuilder` factories for common patterns. Import from `flowneer/presets` or their individual subpath.

### Agent presets (`flowneer/presets/agent`)

| Preset               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `createAgent`        | LangChain-style factory — wire up tools and an LLM adapter to get a runnable agent |
| `withReActLoop`      | ReAct think -> tool-call -> observe loop with configurable max iterations          |
| `supervisorCrew`     | Supervisor dispatches to parallel worker agents, with an optional aggregator step  |
| `sequentialCrew`     | Agents run in sequence, each receiving the output of the previous                  |
| `hierarchicalCrew`   | Tree-structured multi-agent delegation                                             |
| `roundRobinDebate`   | Agents take turns responding for N rounds                                          |
| `planAndExecute`     | Planner LLM produces a step-by-step plan; executor LLM carries out each step       |
| `reflexionAgent`     | Generate -> critique -> revise loop (Reflexion paper)                              |
| `critiqueAndRevise`  | Two-agent generate -> critique -> revise loop                                      |
| `evaluatorOptimizer` | DSPy-style generate -> evaluate -> improve loop                                    |
| `selfConsistency`    | Parallel sampling + majority-vote aggregation                                      |
| `tool`               | Minimal tool-calling agent helper                                                  |

### Pipeline presets (`flowneer/presets/pipeline`)

| Preset               | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `generateUntilValid` | Generate -> validate -> retry with error context until output passes     |
| `mapReduceLlm`       | Batch LLM calls across N items, then reduce results into a single output |

### RAG presets (`flowneer/presets/rag`)

| Preset         | Description                                               |
| -------------- | --------------------------------------------------------- |
| `ragPipeline`  | Standard retrieve -> augment -> generate pipeline         |
| `iterativeRag` | RAG with follow-up retrieval loop for multi-hop questions |

### Config presets (`flowneer/presets/config`)

| Preset  | Description                                                      |
| ------- | ---------------------------------------------------------------- |
| `build` | Compile a `FlowConfig` JSON/object into a runnable `FlowBuilder` |

---

## License

MIT
