# withDryRun

Skips all step bodies while still firing `beforeStep` and `afterStep` hooks. Use in tests and CI to validate hook wiring and observability pipelines without executing real side effects.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withDryRun } from "flowneer/plugins/dev";

FlowBuilder.use(withDryRun);
```

## Usage

```typescript
const events: string[] = [];

const flow = new FlowBuilder<State>()
  .withDryRun()
  .withCallbacks({
    onChainStart: (meta) => events.push(`start:${meta.index}`),
    onChainEnd: (meta) => events.push(`end:${meta.index}`),
  })
  .startWith(async (s) => {
    await callExternalApi(s); /* never runs */
  })
  .then(async (s) => {
    await saveToDb(s); /* never runs */
  });

await flow.run({});
console.log(events);
// ["start:0", "end:0", "start:1", "end:1"]
// Step bodies didn't run, but hooks fired correctly
```

## How It Works

Registers a `wrapStep` hook that does nothing — `next()` is never called, so the step body is skipped. Because hooks registered before `withDryRun` run in their own `wrapStep` layers, those hooks still fire.

## Use Cases

- Validate that your observability and callback wiring is correct without real I/O.
- Benchmark hook overhead in isolation.
- Snapshot-test step sequences in unit tests.

## Notes

- `withDryRun` affects **all** steps, including those inside `.loop()`, `.batch()`, and `.parallel()` bodies.
- State remains unchanged (since step bodies don't run), so hooks that read from `shared` will see the initial values.
- Combine with [`withMocks`](./mocks.md) if you want some steps to execute with fake implementations.
