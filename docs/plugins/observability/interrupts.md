# withInterrupts / interruptIf

Insert conditional pause points into a flow. When the condition is true, the flow throws an `InterruptError` carrying a deep clone of the current shared state. Catch it in your runner to implement approval gates, human review, or external-resume patterns.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withInterrupts } from "flowneer/plugins/observability";

FlowBuilder.use(withInterrupts);
```

## Usage

```typescript
import { InterruptError } from "flowneer";

const flow = new FlowBuilder<State>()
  .startWith(generateDraft)
  .interruptIf((s) => s.draft.length > 0) // pause after draft is ready
  .then(publishDraft);

try {
  await flow.run(shared);
} catch (e) {
  if (e instanceof InterruptError) {
    const saved = e.savedShared as State;
    console.log("Draft ready for review:", saved.draft);
    // Human reviews... then resume:
    saved.approved = true;
    await flow.run(saved); // re-runs from scratch
    // Use withReplay to skip completed steps
  }
}
```

## API

### `.interruptIf(condition)`

```typescript
.interruptIf(
  (shared: S, params: P) => boolean | Promise<boolean>
)
```

Inserts a synthetic step that:

1. Evaluates `condition(shared, params)`.
2. If `true`, throws `new InterruptError(JSON.parse(JSON.stringify(shared)))`.
3. If `false`, does nothing — flow continues.

## `InterruptError`

```typescript
class InterruptError extends Error {
  savedShared: unknown; // deep clone of shared at interrupt time
}
```

`InterruptError` is **never wrapped** in `FlowError` — it propagates directly to the caller.

## Resume with Replay

Combine with [`withReplay`](../persistence/replay.md) to skip already-completed steps when resuming:

```typescript
import { withReplay } from "flowneer/plugins/persistence";
FlowBuilder.use(withReplay);

try {
  await flow.run(shared);
} catch (e) {
  if (e instanceof InterruptError) {
    const saved = e.savedShared as State;
    // e.g. interrupt was at step 2, so resume from step 3:
    flow.withReplay(3);
    await flow.run({ ...saved, approved: true });
  }
}
```

## See Also

- [humanNode](../agent/human-node.md) — higher-level human-in-the-loop with prompt storage and a `resumeFlow` helper.
- [Errors](../../core/errors.md) — full error hierarchy.
