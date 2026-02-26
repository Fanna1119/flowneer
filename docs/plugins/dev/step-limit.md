# withStepLimit

Throws if the total number of step executions in a single `.run()` call exceeds a configured maximum. A safety net for flows that use anchors and loops.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withStepLimit } from "flowneer/plugins/dev";

FlowBuilder.use(withStepLimit);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withStepLimit(500) // abort if more than 500 steps execute
  .anchor("loop")
  .then(async (s) => {
    await processItem(s);
    if (!s.done) return "#loop";
  });
```

## API

### `.withStepLimit(max?: number)`

| Parameter | Type     | Default | Description                           |
| --------- | -------- | ------- | ------------------------------------- |
| `max`     | `number` | `1000`  | Maximum total step executions per run |

## Error

When exceeded: `"step limit exceeded: N > max"`.

## Counter Resets

The counter resets at `beforeFlow`, so each `.run()` call starts from 0.

## Relationship with `withCycles`

| Plugin          | What it counts                            |
| --------------- | ----------------------------------------- |
| `withStepLimit` | Total step executions (including repeats) |
| `withCycles`    | Anchor jump events only                   |

Use `withCycles` for anchor-specific safeguards and `withStepLimit` as a global execution ceiling.
