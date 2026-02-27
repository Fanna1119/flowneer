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
</p>

A tiny, zero-dependency fluent flow builder for TypeScript. Chain steps, branch on conditions, loop, batch-process, and run tasks in parallel — all through a single `FlowBuilder` class. Extend it with plugins for tool calling, ReAct agent loops, human-in-the-loop, memory, structured output, streaming, graph-based flow composition, eval, and more.

> Flowneer is currently under heavy development with ongoing pattern exploration and architectural refinement. Breaking changes are expected frequently, potentially on a daily basis, as the core design is actively evolving.

## Install

```bash
bun add flowneer
```

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

## API

### `startWith(fn, options?)`

Set the first step, resetting any prior chain.

### `then(fn, options?)`

Append a sequential step.

### `branch(router, branches, options?)`

Route to a named branch based on the return value of `router`.

```typescript
interface AuthState {
  role: string;
  message: string;
}

await new FlowBuilder<AuthState>()
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
// → Welcome, admin!
```

### `loop(condition, body)`

Repeat a sub-flow while `condition` returns `true`.

```typescript
interface TickState {
  ticks: number;
}

await new FlowBuilder<TickState>()
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
// → done, ticks = 3
```

### `batch(items, processor, options?)`

Run a sub-flow once per item. The current item is written to `shared.__batchItem` by default.

```typescript
interface SumState {
  numbers: number[];
  results: number[];
  __batchItem?: number;
}

await new FlowBuilder<SumState>()
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
// → [2, 4, 6]
```

**Nested batches** — pass a `{ key }` option to give each level its own property name, so inner and outer items don't overwrite each other:

```typescript
interface NestedState {
  groups: { name: string; members: string[] }[];
  results: string[];
  __group?: { name: string; members: string[] };
  __member?: string;
}

await new FlowBuilder<NestedState>()
  .batch(
    (s) => s.groups,
    (b) =>
      b
        .startWith((s) => {
          // s.__group is the current group
        })
        .batch(
          (s) => s.__group!.members,
          (inner) =>
            inner.startWith((s) => {
              // both s.__group and s.__member are accessible
              s.results.push(`${s.__group!.name}:${s.__member!}`);
            }),
          { key: "__member" },
        ),
    { key: "__group" },
  )
  .run({ groups: [{ name: "A", members: ["a1", "a2"] }], results: [] });
// → results: ["A:a1", "A:a2"]
```

### `parallel(fns, options?, reducer?)`

Run multiple functions concurrently against the same shared state.

```typescript
interface FetchState {
  posts?: any[];
  users?: any[];
}

await new FlowBuilder<FetchState>()
  .parallel([
    async (s) => {
      const res = await fetch("https://jsonplaceholder.typicode.com/posts");
      s.posts = await res.json();
    },
    async (s) => {
      const res = await fetch("https://jsonplaceholder.typicode.com/users");
      s.users = await res.json();
    },
  ])
  .then(async (s) => {
    console.log(
      "Fetched",
      s.posts?.length,
      "posts and",
      s.users?.length,
      "users",
    );
  })
  .run({});
// → Fetched 100 posts and 10 users
```

When a `reducer` is provided each fn receives its own **shallow clone** of `shared`, preventing concurrent write races. After all fns settle the reducer merges the drafts back into the original:

```typescript
interface ScoreState {
  value: number;
}

await new FlowBuilder<ScoreState>()
  .parallel(
    [
      async (s) => {
        s.value += 10;
      },
      async (s) => {
        s.value += 20;
      },
    ],
    undefined,
    (original, drafts) => {
      // drafts[0].value === 10, drafts[1].value === 20 (each started at 0)
      original.value = drafts.reduce((sum, d) => sum + d.value, 0);
    },
  )
  .run({ value: 0 });
// original.value === 30
```

See [`withAtomicUpdates`](#withatomicupdates) for the plugin shorthand.

### `anchor(name)`

Insert a named marker in the step chain. Anchors are no-ops during normal execution — they exist only as jump targets.

Any `NodeFn` can return `"#anchorName"` to jump back (or forward) to that anchor, enabling iterative refinement and reflection loops without nesting:

```typescript
interface RefineState {
  draft: string;
  passes: number;
  quality: number;
}

await new FlowBuilder<RefineState>()
  .startWith(async (s) => {
    s.draft = await generateDraft(s);
  })
  .anchor("refine")
  .then(async (s) => {
    s.quality = await scoreDraft(s.draft);
    if (s.quality < 0.8) {
      s.draft = await improveDraft(s.draft);
      s.passes++;
      return "#refine"; // jump back to the anchor
    }
  })
  .then(async (s) => console.log("Final draft after", s.passes, "passes"))
  .run({ draft: "", passes: 0, quality: 0 });
```

> **Tip:** Pair with [`withCycles`](#withcycles) to cap the maximum number of jumps.

## using with `withCycles` plugin

`withCycles` guards against infinite anchor-jump loops. Each call registers one limit; multiple calls stack.

**Global limit** — throws after `n` total anchor jumps across the whole flow:

```typescript
import { FlowBuilder } from "flowneer";
import { withCycles } from "flowneer/plugins/resilience";

FlowBuilder.use(withCycles);

const flow = new FlowBuilder<State>()
  .withCycles(5) // max 5 total anchor jumps
  .startWith(async (s) => {
    s.count = 0;
  })
  .anchor("loop")
  .then(async (s) => {
    s.count += 1;
    if (s.count < 3) return "#loop"; // jump back to "loop" anchor
  })
  .then(async (s) => console.log("done, count =", s.count));
```

**Per-anchor limit** — pass an anchor name as the second argument to restrict visits to that specific anchor only:

```typescript
const flow = new FlowBuilder<State>()
  .withCycles(5, "refine") // max 5 visits to the "refine" anchor
  .startWith(generateDraft)
  .anchor("refine")
  .then(async (s) => {
    s.quality = await score(s.draft);
    if (s.quality < 0.8) {
      s.draft = await improve(s.draft);
      return "#refine";
    }
  });
```

**Mixed** — combine a global cap with independent per-anchor limits by chaining calls. Each limit is evaluated independently:

```typescript
const flow = new FlowBuilder<State>()
  .withCycles(100)          // global: max 100 total anchor jumps
  .withCycles(5, "fast")    // "fast" anchor: max 5 visits
  .withCycles(10, "retry")  // "retry" anchor: max 10 visits
  ...
```

Unlisted anchors are unaffected by per-anchor limits. The global limit (if set) still counts every jump regardless of which anchor was targeted.

### `run(shared, params?, options?)`

Execute the flow. Optionally pass a `params` object that every step receives as a second argument.

```typescript
// Basic
await flow.run(shared);

// With params
await flow.run(shared, { userId: "123" });

// With AbortSignal — cancels between steps when the signal fires
const controller = new AbortController();
await flow.run(shared, undefined, { signal: controller.signal });
```

### `stream(shared, params?, options?)`

An async-generator alternative to `run()` that yields `StreamEvent` values as the flow executes. Useful for pushing incremental updates to a UI or SSE endpoint.

```typescript
import type { StreamEvent } from "flowneer";

for await (const event of flow.stream(shared)) {
  if (event.type === "step:before") console.log("→ step", event.meta.index);
  if (event.type === "step:after") console.log("✓ step", event.meta.index);
  if (event.type === "chunk") process.stdout.write(event.chunk as string);
  if (event.type === "error") console.error(event.error);
  if (event.type === "done") break;
}
```

Steps emit chunks by assigning to `shared.__stream`; each assignment yields a `"chunk"` event:

```typescript
.then(async (s) => {
  for await (const token of llmStream()) {
    s.__stream = token; // → yields { type: "chunk", chunk: token, meta }
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

### Options

Any step that accepts `options` supports:

| Option      | Default | Description                                            |
| ----------- | ------- | ------------------------------------------------------ |
| `retries`   | `1`     | Number of attempts before throwing                     |
| `delaySec`  | `0`     | Seconds to wait between retries                        |
| `timeoutMs` | `0`     | Milliseconds before the step is aborted (0 = no limit) |

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

Errors inside `loop` and `batch` sub-flows are wrapped the same way:

```
FlowError: Flow failed at loop (step 1): exploded on tick 2
FlowError: Flow failed at batch (step 0): bad item: 3
```

### `InterruptError`

`InterruptError` is a special error that **bypasses `FlowError` wrapping** — it propagates directly to the caller. Use it for human-in-the-loop and approval patterns (via [`withInterrupts`](#withinterrupts)).

```typescript
import { FlowBuilder, InterruptError } from "flowneer";

try {
  await flow.run(shared);
} catch (err) {
  if (err instanceof InterruptError) {
    // err.savedShared is a deep clone of state at the interrupt point
    const approval = await askHuman(err.savedShared);
    if (approval) await flow.run(shared); // resume from scratch or use withReplay
  }
}
```

## Plugins

The core is intentionally small. Use `FlowBuilder.use(plugin)` to add chain methods.

A plugin is an object of functions that get copied onto `FlowBuilder.prototype`. Each function receives the builder as `this` and should return `this` for chaining.

### Available plugins

| Category          | Plugin                    | Method                                    | Description                                                                                                        |
| ----------------- | ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Observability** | `withHistory`             | `.withHistory()`                          | Appends a shallow state snapshot after each step to `shared.__history`                                             |
|                   | `withTiming`              | `.withTiming()`                           | Records wall-clock duration (ms) of each step in `shared.__timings[index]`                                         |
|                   | `withVerbose`             | `.withVerbose()`                          | Prints the full `shared` object to stdout after each step                                                          |
|                   | `withInterrupts`          | `.interruptIf(condition)`                 | Pauses the flow by throwing an `InterruptError` (with a deep-clone of `shared`) when condition is true             |
|                   | `withCallbacks`           | `.withCallbacks(handlers)`                | LangChain-style lifecycle callbacks dispatched by step label prefix (`llm:*`, `tool:*`, `agent:*`)                 |
| **Persistence**   | `withCheckpoint`          | `.withCheckpoint(store)`                  | Saves `shared` to a store after each successful step                                                               |
|                   | `withAuditLog`            | `.withAuditLog(store)`                    | Writes an immutable deep-clone audit entry to a store after every step (success and error)                         |
|                   | `withReplay`              | `.withReplay(fromStep)`                   | Skips all steps before `fromStep`; combine with `.withCheckpoint()` to resume a failed flow                        |
|                   | `withVersionedCheckpoint` | `.withVersionedCheckpoint(store)`         | Saves diff-based versioned checkpoints with parent pointers after each step that changes state                     |
|                   |                           | `.resumeFrom(version, store)`             | Resolves a version id and skips all steps up to and including the saved step index                                 |
| **Resilience**    | `withCircuitBreaker`      | `.withCircuitBreaker(opts?)`              | Opens the circuit after `maxFailures` consecutive failures and rejects all steps until `resetMs` elapses           |
|                   | `withFallback`            | `.withFallback(fn)`                       | Catches any step error and calls `fn` instead of propagating, allowing the flow to continue                        |
|                   | `withTimeout`             | `.withTimeout(ms)`                        | Aborts any step that exceeds `ms` milliseconds with a descriptive error                                            |
|                   | `withCycles`              | `.withCycles(n, anchor?)`                 | Throws after `n` anchor jumps globally, or after `n` visits to a named anchor — guards against infinite goto loops |
| **Messaging**     | `withChannels`            | `.withChannels()`                         | Initialises a `Map`-based message-channel system on `shared.__channels`                                            |
|                   | `withStream`              | `.withStream()`                           | Enables real-time chunk streaming via `shared.__stream` (see `.stream()`)                                          |
| **LLM**           | `withCostTracker`         | `.withCostTracker()`                      | Accumulates per-step `shared.__stepCost` values into `shared.__cost` after each step                               |
|                   | `withRateLimit`           | `.withRateLimit({ intervalMs })`          | Enforces a minimum gap of `intervalMs` ms between steps to avoid hammering rate-limited APIs                       |
|                   | `withTokenBudget`         | `.withTokenBudget(limit)`                 | Aborts the flow before any step where `shared.tokensUsed >= limit`                                                 |
|                   | `withStructuredOutput`    | `.withStructuredOutput(opts)`             | Parses and validates a step's LLM output (`shared.__llmOutput`) into a typed object via a Zod-compatible validator |
| **Tools**         | `withTools`               | `.withTools(registry)`                    | Attaches a `ToolRegistry` to `shared.__tools`; call `registry.execute()` or helpers from any step                  |
| **Agent**         | `withReActLoop`           | `.withReActLoop(opts)`                    | Built-in ReAct loop: think → tool-call → observe, with configurable `maxIterations` and `onObservation`            |
|                   | `withHumanNode`           | `.humanNode(opts?)`                       | Inserts a human-in-the-loop pause; pair with `resumeFlow()` to continue after receiving input                      |
| **Memory**        | `withMemory`              | `.withMemory(instance)`                   | Attaches a `Memory` instance to `shared.__memory`; choose `BufferWindowMemory`, `SummaryMemory`, or `KVMemory`     |
| **Graph**         | `withGraph`               | `.withGraph()`                            | Describe a flow as a DAG with `.addNode()` / `.addEdge()`, then `.compile()` to a `FlowBuilder` chain              |
| **Telemetry**     | `withTelemetry`           | `.withTelemetry(opts?)`                   | Structured span telemetry via `TelemetryDaemon`; accepts `consoleExporter`, `otlpExporter`, or a custom exporter   |
| **Dev**           | `withDryRun`              | `.withDryRun()`                           | Skips all step bodies while still firing hooks — useful for validating observability wiring                        |
|                   | `withMocks`               | `.withMocks(map)`                         | Replaces step bodies at specified indices with mock functions; all other steps run normally                        |
|                   | `withStepLimit`           | `.withStepLimit(max?)`                    | Throws after `max` total step executions (default 1000); counter resets on each `run()` call                       |
|                   | `withAtomicUpdates`       | `.parallelAtomic(fns, reducer, options?)` | Sugar over `parallel()` with a reducer — each fn runs on an isolated draft, reducer merges results                 |

Plugins are imported from `flowneer/plugins` (or their individual subpath) and registered once with `FlowBuilder.use()`:

```typescript
import { withTiming, withCostTracker } from "flowneer/plugins";

FlowBuilder.use(withTiming);
FlowBuilder.use(withCostTracker);
```

Messaging utilities are standalone functions — no need to register them as a plugin method:

```typescript
import {
  withChannels,
  sendTo,
  receiveFrom,
  peekChannel,
} from "flowneer/plugins/messaging";

FlowBuilder.use(withChannels);

const flow = new FlowBuilder()
  .withChannels()
  .startWith(async (s) => {
    sendTo(s, "results", { score: 42 });
  })
  .then(async (s) => {
    const msgs = receiveFrom(s, "results"); // [{ score: 42 }]
  });
```

---

### Writing a plugin

```typescript
import type { FlowBuilder, FlowneerPlugin, StepMeta } from "flowneer";

// 1. Augment the FlowBuilder interface for type safety
declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withTracing(fn: (meta: StepMeta, event: string) => void): this;
  }
}

// 2. Implement the plugin
export const observePlugin: FlowneerPlugin = {
  withTracing(this: FlowBuilder<any, any>, fn) {
    (this as any)._setHooks({
      beforeStep: (meta: StepMeta) => fn(meta, "before"),
      afterStep: (meta: StepMeta) => fn(meta, "after"),
      onError: (meta: StepMeta) => fn(meta, "error"),
    });
    return this;
  },
};
```

### Using a plugin

```typescript
import { FlowBuilder } from "flowneer";
import { observePlugin } from "./observePlugin";

FlowBuilder.use(observePlugin); // one-time registration

const flow = new FlowBuilder<MyState>()
  .withTracing((meta, event) => console.log(event, meta.type, meta.index))
  .startWith(step1)
  .then(step2);
```

### Lifecycle hooks

Plugins register hooks via `_setHooks()`. The following hook points are available:

| Hook             | Called                                                    | Arguments                               |
| ---------------- | --------------------------------------------------------- | --------------------------------------- |
| `beforeFlow`     | Once before the first step                                | `(shared, params)`                      |
| `beforeStep`     | Before each step executes                                 | `(meta, shared, params)`                |
| `wrapStep`       | Wraps step execution — call `next()` to run the step body | `(meta, next, shared, params)`          |
| `afterStep`      | After each step completes                                 | `(meta, shared, params)`                |
| `wrapParallelFn` | Wraps each individual fn inside a `parallel()` step       | `(meta, fnIndex, next, shared, params)` |
| `onError`        | When a step throws (before re-throwing)                   | `(meta, error, shared, params)`         |
| `afterFlow`      | After the flow finishes (success or failure)              | `(shared, params)`                      |

Multiple `wrapStep` (or `wrapParallelFn`) registrations compose — the first registered is the outermost wrapper. Omitting `next()` skips the step body entirely (used by `withDryRun`, `withMocks`, `withReplay`).

### What plugins are for

| Concern                      | Plugin / hook                     | Hook(s) used                             |
| ---------------------------- | --------------------------------- | ---------------------------------------- |
| Observability / tracing      | `withHistory`, `withTiming`       | `beforeStep` + `afterStep`               |
| Lifecycle callbacks          | `withCallbacks`                   | `beforeStep` + `afterStep` + `onError`   |
| Persistence / checkpointing  | `withCheckpoint`                  | `afterStep`                              |
| Versioned persistence        | `withVersionedCheckpoint`         | `beforeFlow` + `afterStep`               |
| Step/execution skip          | `withDryRun`, `withReplay`        | `wrapStep`                               |
| Safe parallel isolation      | `withAtomicUpdates`               | `wrapParallelFn` (via core reducer)      |
| Human-in-the-loop / approval | `withInterrupts`, `withHumanNode` | `then()` + `InterruptError`              |
| Message passing              | `withChannels`                    | `beforeFlow`                             |
| Real-time streaming          | `withStream` / `.stream()`        | `afterStep` (chunk injection)            |
| Infinite-loop protection     | `withCycles`, `withStepLimit`     | `afterStep` / `beforeStep`               |
| Tool calling                 | `withTools`                       | `beforeFlow`                             |
| Agent loops                  | `withReActLoop`                   | `then()` + `loop()`                      |
| Memory management            | `withMemory`                      | `beforeFlow`                             |
| Structured output            | `withStructuredOutput`            | `afterStep`                              |
| Graph-based composition      | `withGraph`                       | DSL compiler (pre-run)                   |
| Telemetry / spans            | `withTelemetry`                   | `beforeStep` + `afterStep` + `afterFlow` |
| Cleanup / teardown           | custom                            | `afterFlow`                              |

See [examples/observePlugin.ts](examples/observePlugin.ts) and [examples/persistPlugin.ts](examples/persistPlugin.ts) for complete implementations.

---

## Tool calling

Register typed tools and call them from any step:

```typescript
import { withTools, ToolRegistry, executeTool } from "flowneer/plugins/tools";
FlowBuilder.use(withTools);

const tools = new ToolRegistry([
  {
    name: "search",
    description: "Search the web",
    params: { query: { type: "string", description: "Query", required: true } },
    execute: async ({ query }) => fetchSearchResults(query),
  },
]);

const flow = new FlowBuilder<State>().withTools(tools).startWith(async (s) => {
  const result = await s.__tools.execute({
    name: "search",
    args: { query: s.question },
  });
  s.searchResult = result;
});
```

`ToolRegistry` exposes `get`, `has`, `names`, `definitions`, `execute`, and `executeAll`. The standalone helpers `getTools(s)`, `executeTool(s, call)`, and `executeTools(s, calls)` work without the plugin method.

---

## ReAct agent loop

`.withReActLoop` inserts a wired think → tool-call → observe loop. Your `think` function receives the current state (including `shared.__toolResults` from the previous round) and returns either a finish action or tool calls:

```typescript
import { withReActLoop } from "flowneer/plugins/agent";
FlowBuilder.use(withReActLoop);

const flow = new FlowBuilder<State>().withTools(tools).withReActLoop({
  maxIterations: 8,
  think: async (s) => {
    const res = await llm(s.messages);
    return res.toolCalls.length
      ? { action: "tool", calls: res.toolCalls }
      : { action: "finish", output: res.text };
  },
  onObservation: (results, s) => {
    s.messages.push({ role: "tool", content: JSON.stringify(results) });
  },
});

// After run: s.__reactOutput holds the final answer
// s.__reactExhausted === true if maxIterations was reached
```

---

## Human-in-the-loop with `humanNode`

`.humanNode()` is a higher-level alternative to `interruptIf`. The `resumeFlow` helper merges human edits back into the saved state and re-runs:

```typescript
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";
FlowBuilder.use(withHumanNode);

const flow = new FlowBuilder<DraftState>()
  .startWith(generateDraft)
  .humanNode({ prompt: "Please review the draft." })
  .then(publishDraft);

try {
  await flow.run(state);
} catch (e) {
  if (e instanceof InterruptError) {
    const feedback = await showReviewUI(e.savedShared);
    await resumeFlow(flow, e.savedShared, { feedback });
  }
}
```

---

## Multi-agent patterns

Four factory functions compose flows into common multi-agent topologies:

```typescript
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "flowneer/plugins/agent";

// Supervisor → parallel workers → optional aggregator
const crew = supervisorCrew<State>(
  (s) => {
    s.plan = makePlan(s);
  },
  [researchAgent, codeAgent, reviewAgent],
  {
    post: (s) => {
      s.report = compile(s);
    },
  },
);
await crew.run(state);

// Round-robin debate across agents for N rounds
const debate = roundRobinDebate<State>([agentA, agentB, agentC], 3);
await debate.run(state);
```

All factory functions return a plain `FlowBuilder` and compose with every other plugin.

---

## Memory

Three memory classes let you manage conversation history. All implement the same `Memory` interface (`add / get / clear / toContext`):

```typescript
import {
  BufferWindowMemory,
  SummaryMemory,
  KVMemory,
  withMemory,
} from "flowneer/plugins/memory";
FlowBuilder.use(withMemory);

const memory = new BufferWindowMemory({ maxMessages: 20 });

const flow = new FlowBuilder<State>()
  .withMemory(memory) // attaches to shared.__memory
  .startWith(async (s) => {
    s.__memory.add({ role: "user", content: s.userInput });
    const history = s.__memory.toContext();
    s.response = await llm(history);
    s.__memory.add({ role: "assistant", content: s.response });
  });
```

| Class                | Behaviour                                                         |
| -------------------- | ----------------------------------------------------------------- |
| `BufferWindowMemory` | Keeps the last `maxMessages` messages (sliding window)            |
| `SummaryMemory`      | Compresses oldest messages via a user-supplied `summarize()` fn   |
| `KVMemory`           | Key-value store; supports `toJSON()` / `fromJSON()` serialisation |

---

## Output parsers

Four pure functions parse structured data from LLM text. No plugin registration needed:

```typescript
import {
  parseJsonOutput,
  parseListOutput,
  parseMarkdownTable,
  parseRegexOutput,
} from "flowneer/plugins/output";

const obj = parseJsonOutput(llmText); // raw JSON, fenced, or embedded in prose
const items = parseListOutput(llmText); // dash, *, •, numbered, or newline-separated
const rows = parseMarkdownTable(llmText); // GFM table → Record<string,string>[]
const match = parseRegexOutput(llmText, /(?<id>\d+)/); // named or positional capture groups
```

All parsers accept an optional `Validator<T>` (Zod-compatible) as the last argument.

---

## Structured output

Validate LLM output against a schema after a step runs. The plugin reads `shared.__llmOutput`, runs the optional `parse` function (e.g. `JSON.parse`), then passes the result through `validator.parse()`:

```typescript
import { withStructuredOutput } from "flowneer/plugins/llm";
FlowBuilder.use(withStructuredOutput);

const flow = new FlowBuilder<State>()
  .withStructuredOutput({ parse: JSON.parse, validator: myZodSchema })
  .startWith(callLlm); // step must write to shared.__llmOutput

// s.__structuredOutput — parsed & validated result
// s.__validationError  — set if parsing or validation failed
```

---

## Eval harness

Run a flow against a labelled dataset and collect per-item scores:

```typescript
import { runEvalSuite, exactMatch, f1Score } from "flowneer/plugins/eval";

const { results, summary } = await runEvalSuite(
  [{ question: "What is 2+2?", expected: "4" }, ...],
  myFlow,
  {
    accuracy: (item, s) => exactMatch(s.answer, item.expected),
    f1:       (item, s) => f1Score(s.answer, item.expected),
  },
);

console.log(summary.accuracy.mean, summary.f1.mean);
```

Available scorers: `exactMatch`, `containsMatch`, `f1Score`, `retrievalPrecision`, `retrievalRecall`, `answerRelevance`. Each dataset item runs in a deep-cloned state — no bleed between items. Errors are captured per-item rather than aborting the suite.

---

## Graph-based flow composition

Describe a flow as a directed graph and let Flowneer compile the execution order:

```typescript
import { withGraph } from "flowneer/plugins/graph";
FlowBuilder.use(withGraph);

const flow = (new FlowBuilder<State>() as any)
  .withGraph()
  .addNode("fetch", (s) => {
    s.data = fetch(s.url);
  })
  .addNode("parse", (s) => {
    s.parsed = parse(s.data);
  })
  .addNode("validate", (s) => {
    s.valid = validate(s.parsed);
  })
  .addNode("retry", (s) => {
    s.url = nextUrl(s);
  })
  .addEdge("fetch", "parse")
  .addEdge("parse", "validate")
  .addEdge("validate", "retry", (s) => !s.valid) // conditional back-edge → loop
  .addEdge("retry", "fetch")
  .compile(); // returns a ready-to-run FlowBuilder

await flow.run({ url: "https://..." });
```

`compile()` runs Kahn's topological sort on unconditional edges, classifies conditional edges as forward jumps or back-edges, inserts `anchor` markers for back-edge targets, and emits the matching `FlowBuilder` chain. Throws descriptively on empty graphs, duplicate node names, unknown edge targets, or unconditional cycles.

---

## AI agent example

Flowneer's primitives map directly to common agent patterns:

```typescript
import { FlowBuilder } from "flowneer";

interface AgentState {
  question: string;
  history: Message[];
  intent?: string;
  answer?: string;
}

const agent = new FlowBuilder<AgentState>()
  .startWith(classifyIntent)
  .branch((s) => s.intent, {
    weather: fetchWeather,
    joke: tellJoke,
    default: generalAnswer,
  })
  .then(formatAndRespond);

await agent.run({ question: "What's the weather in Paris?", history: [] });
```

A ReAct-style loop:

```typescript
const reactAgent = new FlowBuilder<AgentState>()
  .startWith(think)
  .loop(
    (s) => !s.done,
    (b) =>
      b
        .startWith(selectTool)
        .branch(routeTool, {
          search: webSearch,
          code: runCode,
          default: respond,
        })
        .then(observe),
  )
  .then(formatOutput);
```

See [examples/assistantFlow.ts](examples/assistantFlow.ts) for a full interactive agent.

### Agent-to-agent delegation

There is no special primitive for sub-agents — just call `anotherFlow.run(shared)` inside a `then`. Since `shared` is passed by reference, the sub-agent reads and writes the same state seamlessly:

```typescript
const researchAgent = new FlowBuilder<ReportState>()
  .startWith(searchWeb)
  .then(summariseSources);

const writeAgent = new FlowBuilder<ReportState>()
  .startWith(draftReport)
  .then(formatMarkdown);

const orchestrator = new FlowBuilder<ReportState>()
  .startWith(async (s) => {
    s.query = "LLM benchmarks 2025";
  })
  .then(async (s) => researchAgent.run(s)) // delegate → sub-agent mutates s
  .then(async (s) => writeAgent.run(s)) // delegate → sub-agent mutates s
  .then(async (s) => console.log(s.report));
```

Any number of flows can be composed this way. Each sub-agent is itself a `FlowBuilder`, so it can have its own retries, branches, and plugins.

### Parallel sub-agents

Use `parallel` when sub-agents are independent and can run concurrently:

```typescript
const sentimentAgent = new FlowBuilder<AnalysisState>()
  .startWith(classifySentiment)
  .then(scoreSentiment);

const summaryAgent = new FlowBuilder<AnalysisState>()
  .startWith(extractKeyPoints)
  .then(writeSummary);

const toxicityAgent = new FlowBuilder<AnalysisState>().startWith(checkToxicity);

const orchestrator = new FlowBuilder<AnalysisState>()
  .startWith(async (s) => {
    s.text = "...input text...";
  })
  .parallel([
    (s) => sentimentAgent.run(s), // writes s.sentiment
    (s) => summaryAgent.run(s), // writes s.summary
    (s) => toxicityAgent.run(s), // writes s.toxicity
  ])
  .then(async (s) => {
    console.log(s.sentiment, s.summary, s.toxicity);
  });
```

All three sub-agents share the same `shared` object and run concurrently. Avoid writing to the same key from parallel sub-agents — writes are not synchronised.

To eliminate race conditions entirely, pass a `reducer` as the third argument to `.parallel()`, or use `.parallelAtomic()` from [`withAtomicUpdates`](#withatomicupdates). Each sub-agent then operates on its own isolated draft and the reducer decides how to merge.

### Iterative refinement with `anchor` + goto

Use `anchor` / `#anchor` return values for reflection loops that don't need nesting:

```typescript
const reactAgent = new FlowBuilder<AgentState>()
  .startWith(think)
  .anchor("act")
  .then(async (s) => {
    const result = await callTool(s.toolCall);
    s.observations.push(result);
    s.done = await shouldStop(s);
    if (!s.done) return "#act";
  })
  .then(formatOutput);
```

### Human-in-the-loop with `interruptIf`

```typescript
import { withInterrupts, InterruptError } from "flowneer/plugins/observability";
FlowBuilder.use(withInterrupts);

const flow = new FlowBuilder<DraftState>()
  .startWith(generateDraft)
  .interruptIf((s) => s.requiresApproval) // pauses here
  .then(publishDraft);

try {
  await flow.run(state);
} catch (err) {
  if (err instanceof InterruptError) {
    // err.savedShared holds state at the pause point
    await showReviewUI(err.savedShared);
  }
}
```

## Project structure

```
Flowneer.ts              Core — FlowBuilder, FlowError, InterruptError, Validator, StreamEvent, types
index.ts                 Public exports
plugins/
  observability/
    withHistory.ts       State snapshot history
    withTiming.ts        Per-step wall-clock timing
    withVerbose.ts       Stdout logging
    withInterrupts.ts    Human-in-the-loop / approval gates
    withCallbacks.ts     LangChain-style lifecycle callbacks (llm:/tool:/agent: prefixes)
  persistence/
    withCheckpoint.ts    Post-step state saves
    withAuditLog.ts      Immutable audit trail
    withReplay.ts        Skip-to-step for crash recovery
    withVersionedCheckpoint.ts  Diff-based versioned saves + resumeFrom
  resilience/
    withCircuitBreaker.ts
    withFallback.ts
    withTimeout.ts
    withCycles.ts        Guard against infinite goto loops
  llm/
    withCostTracker.ts
    withRateLimit.ts
    withTokenBudget.ts
    withStructuredOutput.ts  Parse + validate LLM output via Zod-compatible validator
  messaging/
    withChannels.ts      Map-based message channels (sendTo / receiveFrom)
    withStream.ts        Real-time chunk streaming via shared.__stream
  tools/
    withTools.ts         ToolRegistry + withTools plugin + helper functions
  agent/
    withReActLoop.ts     Built-in ReAct think → tool-call → observe loop
    withHumanNode.ts     humanNode() pause + resumeFlow() helper
    patterns.ts          supervisorCrew / sequentialCrew / hierarchicalCrew / roundRobinDebate
  memory/
    types.ts             Memory interface + MemoryMessage type
    bufferWindowMemory.ts  Sliding-window conversation memory
    summaryMemory.ts       Auto-summarising memory (user-supplied summarize fn)
    kvMemory.ts            Key-value memory with JSON serialisation
    withMemory.ts          Plugin that attaches memory to shared.__memory
  output/
    parseJson.ts         Parse raw / fenced / embedded JSON from LLM output
    parseList.ts         Parse dash / numbered / bullet / newline-separated lists
    parseTable.ts        Parse GFM markdown tables to Record<string,string>[]
    parseRegex.ts        Extract named or positional regex capture groups
  eval/
    index.ts             Scoring functions + runEvalSuite
  graph/
    index.ts             withGraph plugin — DAG compiler (addNode / addEdge / compile)
  telemetry/
    telemetry.ts         TelemetryDaemon, consoleExporter, otlpExporter
    index.ts             withTelemetry plugin wrapper
  dev/
    withDryRun.ts
    withMocks.ts
    withStepLimit.ts     Cap total step executions
    withAtomicUpdates.ts parallelAtomic() shorthand
examples/
  assistantFlow.ts       Interactive LLM assistant with branching
  observePlugin.ts       Tracing plugin example
  persistPlugin.ts       Checkpoint plugin example
  clawneer.ts            Full ReAct agent with tool calling
  streamingServer.ts     SSE streaming server example
```

## License

MIT
