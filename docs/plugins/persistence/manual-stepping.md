# withManualStepping

Pause a running flow before each step and resume it on demand. After calling `flow.run()`, execution suspends before each matched step and waits for `flow.stepper.continue()` to be called. The flow runs in-flight on the same async call stack — there is no serialisation or replay involved.

Use this for human-in-the-loop approval gates, interactive debugging, test-driven step inspection, or any scenario where you need to observe and optionally modify shared state between steps.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withManualStepping } from "flowneer/plugins/persistence";

const AppFlow = FlowBuilder.extend([withManualStepping]);
```

## API

### `.withManualStepping(options?)`

Registers the pause gate. Must be called before `.run()`. Returns `this` for chaining.

```typescript
interface ManualSteppingOptions<S> {
  /** Called each time the flow pauses, before the gate blocks. */
  onPause?: (meta: StepMeta, shared: S) => void | Promise<void>;

  /**
   * Narrow which steps cause a pause. Steps not matching the filter
   * execute immediately without pausing.
   * Accepts label globs or a predicate — same semantics as StepFilter elsewhere.
   */
  filter?: StepFilter;
}
```

### `flow.stepper`

A `StepperController` is written onto the builder instance when `.withManualStepping()` is called.

```typescript
interface StepperController<S> {
  /** Current lifecycle status. */
  readonly status: "idle" | "paused" | "running" | "done";

  /** Metadata for the currently paused step, if any. */
  readonly pausedAt: StepMeta | undefined;

  /**
   * Release the paused step and run it.
   * Returns a Promise that resolves when the step body finishes.
   * Errors from the step body surface through flow.run(), not here.
   * Throws if status is not "paused".
   */
  continue(): Promise<void>;

  /**
   * Returns a Promise that resolves with StepMeta when the flow next pauses,
   * or null when the flow completes. Resolves immediately if already paused or done.
   */
  waitUntilPaused(): Promise<StepMeta | null>;
}
```

## Usage

### Explicit steps (Style A)

Call `waitUntilPaused()` and `continue()` manually for fine-grained control. Awaiting `continue()` lets you inspect `shared` after the step body finishes.

```typescript
const flow = new AppFlow<State>()
  .withManualStepping()
  .then(fetchData, { label: "fetch" })
  .then(transform, { label: "transform" })
  .then(save, { label: "save" });

const done = flow.run(shared);

await flow.stepper.waitUntilPaused();
console.log("paused at:", flow.stepper.pausedAt?.label); // "fetch"
await flow.stepper.continue(); // runs fetch, resolves when done

await flow.stepper.waitUntilPaused();
await flow.stepper.continue(); // runs transform

await flow.stepper.waitUntilPaused();
await flow.stepper.continue(); // runs save

await done;
```

### Loop pattern (Style B)

Use `waitUntilPaused()` in a `while` loop — the cleanest approach for automated stepping. The loop exits naturally when the flow finishes.

```typescript
const done = flow.run(shared);

let meta: StepMeta | null;
while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
  console.log("paused at:", meta.label, "| status:", shared);
  await flow.stepper.continue();
}

await done;
```

### Filter — pause only on specific steps

Steps that don't match `filter` run immediately without pausing. Use this to gate only the expensive or sensitive steps (e.g. LLM calls) while letting I/O steps run freely.

```typescript
const flow = new AppFlow<State>()
  .withManualStepping({ filter: ["llm:*"] })
  .then(loadContext, { label: "load" }) // runs freely
  .then(callLlm, { label: "llm:generate" }) // pauses
  .then(persistResult, { label: "persist" }); // runs freely

const done = flow.run(shared);

const meta = await flow.stepper.waitUntilPaused();
// loadContext has already run
console.log("approve LLM call?", meta?.label);
await flow.stepper.continue();
await done;
```

### `onPause` callback

Fires synchronously after `status` is set to `"paused"` but before the gate blocks. Use it for logging, notifications, or side-effecting inspection without modifying the drive loop.

```typescript
const flow = new AppFlow<State>()
  .withManualStepping({
    onPause: (meta, shared) => {
      console.log(
        `[pause] step "${meta.label}" | keys: ${Object.keys(shared).join(", ")}`,
      );
    },
  })
  .then(stepA, { label: "a" })
  .then(stepB, { label: "b" });
```

### Human-in-the-loop approval gate

```typescript
const flow = new AppFlow<DraftState>()
  .withManualStepping({ filter: ["llm:*"] })
  .then(gatherContext, { label: "gather" })
  .then(generateDraft, { label: "llm:draft" }) // pauses for review
  .then(refineDraft, { label: "llm:refine" }) // pauses for review
  .then(publishDraft, { label: "publish" });

const done = flow.run(shared);

while ((await flow.stepper.waitUntilPaused()) !== null) {
  const { label } = flow.stepper.pausedAt!;
  const approved = await askUser(`Approve "${label}"?`);
  if (!approved) {
    done.catch(() => {});
    break;
  }
  await flow.stepper.continue();
}

await done;
```

## Error Handling

Step errors propagate through `flow.run()`, not through `continue()`. `continue()` always resolves once the step body has finished — whether it succeeded or threw.

```typescript
const done = flow.run(shared);

await flow.stepper.waitUntilPaused();
await flow.stepper.continue(); // resolves even if the step throws

// Error surfaces here
await done.catch((err) => console.error("step failed:", err));
```

## Graph Plugin Compatibility

`withManualStepping` composes with `withGraph`. The DAG handler fires `wrapStep` per node internally, so the pause gate triggers once per graph node in topological order.

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

const done = flow.run(shared);

let meta: StepMeta | null;
while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
  console.log("node:", meta.label); // "fetch", "process", "save"
  await flow.stepper.continue();
}
await done;
```

## JsonFlowBuilder Compatibility

Pass your extended `FlowClass` as the third argument to `JsonFlowBuilder.build()`, then call `.withManualStepping()` on the returned instance.

```typescript
import { JsonFlowBuilder } from "flowneer/presets/config";

const ManualJsonFlow = FlowBuilder.extend([withManualStepping]);

const flow = JsonFlowBuilder.build<State>(
  config,
  registry,
  ManualJsonFlow as any,
) as InstanceType<typeof ManualJsonFlow>;

flow.withManualStepping({ filter: ["llm:*"] });

const done = flow.run(shared);
// ... drive with waitUntilPaused / continue
```

## Composing with `withCheckpoint`

Combine with `withCheckpoint` to save state at each pause point — useful for long-running human-in-the-loop flows where you want fault tolerance between approvals.

```typescript
const AppFlow = FlowBuilder.extend([withCheckpoint, withManualStepping]);

const flow = new AppFlow<State>()
  .withCheckpoint({ save: (snap, meta) => db.save(snap, meta) })
  .withManualStepping({ filter: ["llm:*"] })
  .then(callLlm, { label: "llm:generate" });
```

## Notes

- `status` transitions: `"idle"` → `"paused"` → `"running"` → `"idle"` (per step), then `"done"` after `afterFlow`.
- Calling `continue()` when `status !== "paused"` throws immediately with a descriptive message.
- `waitUntilPaused()` uses a one-shot listener — no polling, no race conditions.
- The flow is genuinely suspended in-flight; the async call stack is preserved. There is no serialisation or replay.
- `filter` follows the same `StepFilter` semantics as all other Flowneer plugins: string arrays support `*` wildcards, predicates receive `StepMeta`.
