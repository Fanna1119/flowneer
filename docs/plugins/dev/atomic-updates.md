# parallelAtomic

A convenience wrapper around `.parallel()` with a required reducer. Enforces the safe draft-based parallel execution pattern where each function gets its own shallow clone of `shared`, preventing concurrent write conflicts.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withAtomicUpdates } from "flowneer/plugins/dev";

FlowBuilder.use(withAtomicUpdates);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .startWith(prepareData)
  .parallelAtomic(
    [
      async (s) => {
        s.resultA = await processA(s.input);
      },
      async (s) => {
        s.resultB = await processB(s.input);
      },
      async (s) => {
        s.resultC = await processC(s.input);
      },
    ],
    (shared, [draftA, draftB, draftC]) => {
      shared.resultA = draftA.resultA;
      shared.resultB = draftB.resultB;
      shared.resultC = draftC.resultC;
    },
  )
  .then(combineResults);
```

## API

### `.parallelAtomic(fns, reducer, options?)`

| Parameter | Type                               | Description                           |
| --------- | ---------------------------------- | ------------------------------------- |
| `fns`     | `NodeFn<S, P>[]`                   | Functions to execute concurrently     |
| `reducer` | `(shared: S, drafts: S[]) => void` | Merges draft results back into shared |
| `options` | `NodeOptions`                      | Optional retries, delay, timeout      |

This is a thin alias for `.parallel(fns, options, reducer)` — the reducer parameter is positionally moved to the second argument to make its presence mandatory.

## Why Atomic Parallel?

In plain `.parallel()`, all functions share the same `shared` reference — concurrent mutations can silently overwrite each other:

```typescript
// ❌ Race condition: both fns might clobber shared.results
flow.parallel([
  async (s) => {
    s.results = await processA();
  },
  async (s) => {
    s.results = await processB();
  },
]);
```

With `parallelAtomic`, each function receives its own shallow draft. The reducer runs **after** all functions complete, providing a safe merge point:

```typescript
// ✅ Safe: drafts are isolated
flow.parallelAtomic(
  [
    async (s) => {
      s.aResult = await processA();
    },
    async (s) => {
      s.bResult = await processB();
    },
  ],
  (shared, [dA, dB]) => {
    shared.aResult = dA.aResult;
    shared.bResult = dB.bResult;
  },
);
```
