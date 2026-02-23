# Flowneer

<p>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://badges.ws/npm/v/flowneer" /></a>
  <a href="https://deno.bundlejs.com/?q=flowneer@latest"><img src="https://deno.bundlejs.com/badge?q=flowneer@latest" /></a>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://badges.ws/npm/l/flowneer" /></a>
  <a href="https://www.npmjs.com/package/flowneer"><img src="https://badges.ws/npm/dt/flowneer" /></a>
</p>

A tiny, zero-dependency fluent flow builder for TypeScript. Chain steps, branch on conditions, loop, batch-process, and run tasks in parallel — all through a single `FlowBuilder` class. Extend it with plugins.

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

### `batch(items, processor)`

Run a sub-flow once per item. The current item is available as `shared.__batchItem`.

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

### `parallel(fns, options?)`

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

## Plugins

The core is intentionally small. Use `FlowBuilder.use(plugin)` to add chain methods.

A plugin is an object of functions that get copied onto `FlowBuilder.prototype`. Each function receives the builder as `this` and should return `this` for chaining.

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

Plugins register hooks via `_setHooks()`. Three hook points are available:

| Hook         | Called                                       | Arguments                       |
| ------------ | -------------------------------------------- | ------------------------------- |
| `beforeStep` | Before each step executes                    | `(meta, shared, params)`        |
| `afterStep`  | After each step completes                    | `(meta, shared, params)`        |
| `onError`    | When a step throws (before re-throwing)      | `(meta, error, shared, params)` |
| `afterFlow`  | After the flow finishes (success or failure) | `(shared, params)`              |

### What plugins are for

| Concern                     | Example plugin  | Hook it uses                           |
| --------------------------- | --------------- | -------------------------------------- |
| Observability / tracing     | `observePlugin` | `beforeStep` + `afterStep` + `onError` |
| Persistence / checkpointing | `persistPlugin` | `afterStep`                            |
| Timing / metrics            | custom          | `beforeStep` + `afterStep`             |
| Cleanup / teardown          | custom          | `afterFlow`                            |

See [examples/observePlugin.ts](examples/observePlugin.ts) and [examples/persistPlugin.ts](examples/persistPlugin.ts) for complete implementations.

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

## Project structure

```
Flowneer.ts       Core — FlowBuilder, FlowError, types (~380 lines)
index.ts          Public exports
examples/
  assistantFlow.ts   Interactive LLM assistant with branching
  observePlugin.ts   Tracing plugin example
  persistPlugin.ts   Checkpoint plugin example
```

## License

MIT
