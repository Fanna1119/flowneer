# withTimeout

Applies a per-step wall-clock timeout to **every** step in the flow. If any step exceeds the limit it throws `"step N timed out after Xms"`.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withTimeout } from "flowneer/plugins/resilience";

FlowBuilder.use(withTimeout);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withTimeout(5000) // 5 s per step max
  .startWith(callLlm)
  .then(processResult);
```

## API

### `.withTimeout(ms: number)`

| Parameter | Type     | Description                   |
| --------- | -------- | ----------------------------- |
| `ms`      | `number` | Maximum milliseconds per step |

## Per-Step Timeout

For individual step timeouts without a global limit, use `NodeOptions.timeoutMs`:

```typescript
.then(slowStep, { timeoutMs: 10_000 })
```

Both mechanisms can coexist — the more restrictive limit wins.

## How It Works

Uses `Promise.race` between the step execution and a `setTimeout` rejection. Registered as a `wrapStep` hook so it composes naturally with other plugins.

## Notes

- The timeout applies to the **step body execution time** — hook overhead is not included.
- Timed-out steps throw a plain `Error`, which is wrapped in a `FlowError` by the executor.
- Combine with `retries` to retry timed-out steps: `.then(step, { retries: 2, timeoutMs: 3000 })`.
