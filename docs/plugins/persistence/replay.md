# withReplay

Skips step execution for all steps before a given index. Use together with `withCheckpoint` to resume a flow from the last saved state after a crash or interruption.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withReplay } from "flowneer/plugins/persistence";

FlowBuilder.use(withReplay);
```

## Usage

```typescript
// Normal run — save checkpoints
const checkpoints = new Map<number, State>();
const flow = new FlowBuilder<State>()
  .withCheckpoint({ save: (i, s) => checkpoints.set(i, structuredClone(s)) })
  .startWith(stepA)
  .then(stepB)
  .then(stepC) // crashes here
  .then(stepD);

try {
  await flow.run(initialState);
} catch {
  // Resume from last checkpoint
  const lastSaved = Math.max(...checkpoints.keys());
  const savedState = checkpoints.get(lastSaved)!;

  // Skip steps 0..lastSaved, resume from lastSaved + 1
  flow.withReplay(lastSaved + 1);
  await flow.run(savedState);
}
```

## How It Works

Registers a `wrapStep` hook that skips (does not call `next()`) for any step whose index is less than `fromStep`. Steps at `fromStep` and above execute normally.

`beforeStep` and `afterStep` hooks still fire for skipped steps — only the **body** is skipped.

## API

### `.withReplay(fromStep: number)`

| Parameter  | Type     | Description                                       |
| ---------- | -------- | ------------------------------------------------- |
| `fromStep` | `number` | The first step index that should actually execute |

## Combining with `humanNode` / `interruptIf`

```typescript
import { resumeFlow } from "flowneer/plugins/agent";

// resumeFlow automatically applies withReplay internally:
await resumeFlow(flow, savedState, { approved: true }, interruptedAtStep);
```

See [`resumeFlow`](../agent/human-node.md#resumeflow) for a complete human-in-the-loop example.
