# withHistory

Records a shallow snapshot of `shared` after each step into `shared.__history`. Useful for debugging, replay, and auditing flow execution state transitions.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withHistory } from "flowneer/plugins/observability";

FlowBuilder.use(withHistory);
```

## Usage

```typescript
interface State {
  count: number;
  __history?: Array<{ index: number; type: string; snapshot: any }>;
}

const flow = new FlowBuilder<State>()
  .withHistory()
  .startWith((s) => {
    s.count = 1;
  })
  .then((s) => {
    s.count = 2;
  })
  .then((s) => {
    s.count = 3;
  });

const state: State = { count: 0 };
await flow.run(state);

console.log(state.__history);
// [
//   { index: 0, type: "fn", snapshot: { count: 1 } },
//   { index: 1, type: "fn", snapshot: { count: 2 } },
//   { index: 2, type: "fn", snapshot: { count: 3 } },
// ]
```

## Snapshot Format

Each entry in `shared.__history`:

```typescript
{
  index: number; // step index (0-based)
  type: string; // "fn" | "branch" | "loop" | "batch" | "parallel"
  snapshot: object; // shallow clone of shared, excluding __history itself
}
```

The snapshot is a **shallow** copy — nested objects are not deep-cloned. For deep snapshots, use [`withCheckpoint`](../persistence/checkpoint.md) or [`withAuditLog`](../persistence/audit-log.md).

## State Keys

| Key         | Direction            | Description             |
| ----------- | -------------------- | ----------------------- |
| `__history` | **Read** (your step) | Array of step snapshots |

## Use Cases

- **Debugging:** Inspect what state looked like at each step after a failure.
- **Testing:** Assert that specific state transitions happened in the right order.
- **UI feedback:** Show a progress timeline by reading `__history` incrementally.
