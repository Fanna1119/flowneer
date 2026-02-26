# withTiming

Records the wall-clock duration of each step in `shared.__timings`, keyed by step index.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";

FlowBuilder.use(withTiming);
```

## Usage

```typescript
interface State {
  data: any;
  __timings?: Record<number, number>;
}

const flow = new FlowBuilder<State>()
  .withTiming()
  .startWith(async (s) => {
    s.data = await fetchData();
  })
  .then(async (s) => {
    s.data = transform(s.data);
  })
  .then(async (s) => {
    await save(s.data);
  });

const state: State = { data: null };
await flow.run(state);

console.log(state.__timings);
// { 0: 142, 1: 8, 2: 31 }  ← milliseconds per step
```

## State Keys

| Key         | Direction            | Description                     |
| ----------- | -------------------- | ------------------------------- |
| `__timings` | **Read** (your step) | Map of `stepIndex → durationMs` |

## Accessing Timings

```typescript
.then((s) => {
  const timings = s.__timings ?? {};
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  console.log(`Total: ${total}ms`);
  for (const [step, ms] of Object.entries(timings)) {
    console.log(`  Step ${step}: ${ms}ms`);
  }
})
```

## Tips

- Timings are in milliseconds (integer) via `Date.now()`.
- Sub-flow steps (inside `.loop()`, `.batch()`) are tracked at their own step indices within the sub-flow — they do not appear in the outer flow's `__timings`.
- Combine with `withHistory` to correlate timing data with state snapshots.
