# Getting Started

## Installation

```bash
bun add flowneer
# or
npm install flowneer
# or
pnpm add flowneer
```

## Your First Flow

Every Flowneer flow starts with a `FlowBuilder`. You define a **shared state** type, chain steps, and call `.run()`.

```typescript
import { FlowBuilder } from "flowneer";

interface State {
  input: string;
  result: string;
}

const flow = new FlowBuilder<State>()
  .startWith(async (s) => {
    s.result = s.input.toUpperCase();
  })
  .then(async (s) => {
    console.log(s.result); // "HELLO WORLD"
  });

await flow.run({ input: "hello world", result: "" });
```

### The Shared State Model

All steps operate on the **same object** — `s` in every step is the same reference. Mutate it directly; never replace it with a spread (`s = { ...s }`), as that would break the reference shared between steps.

```typescript
// ✅ Correct — mutate in place
async (s) => {
  s.count += 1;
};

// ❌ Incorrect — replaces the reference, upstream steps see the old object
async (s) => {
  s = { ...s, count: s.count + 1 };
};
```

## Registering Plugins

Plugins extend `FlowBuilder` with new methods. Register a plugin once globally with `FlowBuilder.use()` before creating any flows.

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";
import { withCostTracker } from "flowneer/plugins/llm";

FlowBuilder.use(withTiming);
FlowBuilder.use(withCostTracker);

// Now all FlowBuilder instances have .withTiming() and .withCostTracker()
const flow = new FlowBuilder<State>()
  .withTiming()
  .withCostTracker()
  .startWith(myStep);
```

See [Writing Plugins](./plugins.md) for how to create your own.

## Step Options

Every step (`.startWith`, `.then`, `.parallel`) accepts an optional `NodeOptions` object:

| Option      | Type                         | Default | Description                                |
| ----------- | ---------------------------- | ------- | ------------------------------------------ |
| `retries`   | `number \| (s, p) => number` | `1`     | How many total attempts (1 = no retry)     |
| `delaySec`  | `number \| (s, p) => number` | `0`     | Seconds between retry attempts             |
| `timeoutMs` | `number \| (s, p) => number` | `0`     | Per-step wall-clock timeout (0 = disabled) |

```typescript
const flow = new FlowBuilder<State>().startWith(fetchData, {
  retries: 3,
  delaySec: 1,
  timeoutMs: 5000,
});
```

`retries` and `delaySec` can be functions for dynamic per-step behaviour:

```typescript
.then(myStep, {
  retries: (s) => (s.isImportant ? 5 : 1),
})
```

## Aborting a Flow

Pass an `AbortSignal` to `.run()` to cancel mid-flow:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

await flow.run(shared, {}, { signal: controller.signal });
```

## TypeScript Generics

`FlowBuilder<S, P>` has two type parameters:

- `S` — the shared state type (required)
- `P` — the optional `params` type (defaults to `Record<string, unknown>`)

`params` are read-only contextual values injected at `.run()` time — useful for request-scoped data like user IDs or request metadata.

```typescript
interface Params {
  userId: string;
  requestId: string;
}

const flow = new FlowBuilder<State, Params>().startWith(async (s, params) => {
  s.userId = params.userId;
});

await flow.run(initialState, { userId: "u123", requestId: "r456" });
```
