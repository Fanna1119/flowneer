# withVerbose

Prints the full `shared` state to `stdout` after every step. The simplest way to debug a flow during development.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withVerbose } from "flowneer/plugins/observability";

FlowBuilder.use(withVerbose);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withVerbose()
  .startWith(async (s) => {
    s.step1 = "done";
  })
  .then(async (s) => {
    s.step2 = "done";
  });

await flow.run({});
// [flowneer] step 0 (fn): {
//   "step1": "done"
// }
// [flowneer] step 1 (fn): {
//   "step1": "done",
//   "step2": "done"
// }
```

## Output Format

```
[flowneer] step {index} ({type}): {JSON.stringify(shared, null, 2)}
```

## Tips

- Only enable during development — log output can be large with complex state.
- For production tracing use [`withTiming`](./timing.md), [`withHistory`](./history.md), or [`TelemetryDaemon`](../telemetry/overview.md).
- Combine with `withDryRun` to see hook execution without running step bodies.
