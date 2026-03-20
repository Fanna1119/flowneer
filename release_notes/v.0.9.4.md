# v0.9.4

## New plugin: `withManualStepping`

Adds manual step-by-step execution to any flow. After calling `flow.run()`, execution suspends before each matched step and waits for `flow.stepper.continue()`. The flow runs in-flight — no serialisation, replay, or process restart is involved.

This is distinct from `resumeFrom` (which replays from a checkpoint in a new run) and `InterruptError` (which aborts the run entirely). `withManualStepping` keeps the live async call stack suspended until you explicitly advance it.

### Import

```typescript
import { withManualStepping } from "flowneer/plugins/persistence";
import type {
  StepperController,
  ManualSteppingOptions,
  StepperStatus,
} from "flowneer/plugins/persistence";
```

### Setup

```typescript
const AppFlow = FlowBuilder.extend([withManualStepping]);
```

### Basic usage

```typescript
const flow = new AppFlow<State>()
  .withManualStepping()
  .then(fetchData, { label: "fetch" })
  .then(callLlm, { label: "llm:generate" })
  .then(save, { label: "save" });

const done = flow.run(shared);

// Loop until the flow finishes
let meta: StepMeta | null;
while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
  console.log("paused at:", meta.label);
  await flow.stepper.continue(); // resolves when the step body finishes
}

await done;
```

### `withManualStepping(options?)`

| Option    | Type                                                   | Description                                                                           |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `filter`  | `StepFilter`                                           | Only pause on matching steps; others run freely. Supports label globs and predicates. |
| `onPause` | `(meta: StepMeta, shared: S) => void \| Promise<void>` | Called each time the flow pauses, before the gate blocks.                             |

### `flow.stepper` — `StepperController<S>`

| Member              | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `status`            | `"idle" \| "paused" \| "running" \| "done"`                                                         |
| `pausedAt`          | `StepMeta` of the currently paused step, or `undefined`.                                            |
| `continue()`        | Release the paused step and run it. Resolves when the step body finishes. Throws if not `"paused"`. |
| `waitUntilPaused()` | Resolves with `StepMeta` on next pause, or `null` when the flow is done.                            |

### Filter — pause only on specific steps

```typescript
// Only pause on "llm:*" steps; all others execute immediately
const flow = new AppFlow<State>()
  .withManualStepping({ filter: ["llm:*"] })
  .then(loadContext, { label: "load" }) // runs freely
  .then(callLlm, { label: "llm:generate" }) // pauses
  .then(saveResult, { label: "save" }); // runs freely
```

### Graph plugin compatibility

`wrapStep` is called per node inside the DAG handler, so the pause gate fires once per graph node in topological order.

```typescript
const GraphManualFlow = FlowBuilder.extend([withGraph, withManualStepping]);

const flow = new GraphManualFlow<State>()
  .withManualStepping()
  .addNode("fetch", fetchFn)
  .addNode("process", processFn)
  .addNode("save", saveFn)
  .addEdge("fetch", "process")
  .addEdge("process", "save")
  .compile();
```

### `JsonFlowBuilder` compatibility

Pass the extended class as `FlowClass`, then call `.withManualStepping()` on the result.

```typescript
const ManualJsonFlow = FlowBuilder.extend([withManualStepping]);

const flow = JsonFlowBuilder.build<State>(config, registry, ManualJsonFlow as any)
  as InstanceType<typeof ManualJsonFlow>;

flow.withManualStepping({ filter: ["llm:*"] });
```

### Error handling

`continue()` resolves regardless of whether the step body threw. Errors propagate through `flow.run()` as normal.

### Composing with `withCheckpoint`

```typescript
const AppFlow = FlowBuilder.extend([withCheckpoint, withManualStepping]);

const flow = new AppFlow<State>()
  .withCheckpoint({ save: (snap, meta) => db.save(snap, meta) })
  .withManualStepping({ filter: ["llm:*"] });
```

---

See the full documentation at [`docs/plugins/persistence/manual-stepping.md`](../docs/plugins/persistence/manual-stepping.md) and the runnable example at [`examples/plugins/manualSteppingExample.ts`](../examples/plugins/manualSteppingExample.ts).
