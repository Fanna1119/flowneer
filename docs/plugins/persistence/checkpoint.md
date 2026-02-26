# withCheckpoint

Saves `shared` to a store after each successful step. Combine with `withReplay` to resume interrupted flows from the last saved step.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCheckpoint } from "flowneer/plugins/persistence";

FlowBuilder.use(withCheckpoint);
```

## The `CheckpointStore` Interface

```typescript
interface CheckpointStore<S = any> {
  save: (stepIndex: number, shared: S) => void | Promise<void>;
}
```

Implement it with any storage backend — file system, Redis, SQL, in-memory map, etc.

## Usage

```typescript
// Simple in-memory store
const checkpoints = new Map<number, any>();
const store: CheckpointStore = {
  save: (index, shared) => checkpoints.set(index, structuredClone(shared)),
};

const flow = new FlowBuilder<State>()
  .withCheckpoint(store)
  .startWith(stepA)
  .then(stepB) // crashes here
  .then(stepC);

try {
  await flow.run(initialState);
} catch {
  // Restore last checkpoint and replay from the failed step
  const lastStep = Math.max(...checkpoints.keys());
  const savedState = checkpoints.get(lastStep);

  FlowBuilder.use(withReplay);
  flow.withReplay(lastStep + 1);
  await flow.run(savedState);
}
```

## File-Based Store Example

```typescript
import fs from "fs/promises";

const fileStore: CheckpointStore<MyState> = {
  async save(stepIndex, shared) {
    await fs.writeFile(`checkpoint-${stepIndex}.json`, JSON.stringify(shared));
  },
};
```

## Notes

- `save` is called with the **live** shared object — if you need a snapshot, clone it in your `save` implementation.
- To prevent data loss, call `.withCheckpoint()` before other plugins that may modify shared state in `afterStep` hooks.
- Pairs naturally with [`withReplay`](./replay.md) for crash recovery.
