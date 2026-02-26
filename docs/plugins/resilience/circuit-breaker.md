# withCircuitBreaker

Implements the circuit-breaker pattern at the flow level. After `maxFailures` consecutive step failures, the circuit opens and every subsequent step throws immediately without executing. After `resetMs` milliseconds, the circuit closes and allows one probe attempt.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCircuitBreaker } from "flowneer/plugins/resilience";

FlowBuilder.use(withCircuitBreaker);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withCircuitBreaker({ maxFailures: 3, resetMs: 30_000 })
  .startWith(callExternalApi)
  .then(processResult);

try {
  await flow.run(shared);
} catch (err) {
  if (err.message.startsWith("circuit open")) {
    console.error("External API is unavailable, circuit tripped.");
  }
}
```

## Options

| Option        | Type     | Default | Description                                                     |
| ------------- | -------- | ------- | --------------------------------------------------------------- |
| `maxFailures` | `number` | `3`     | Consecutive failures needed to open the circuit                 |
| `resetMs`     | `number` | `30000` | Milliseconds after which the circuit resets for a probe attempt |

## Circuit States

```
CLOSED (normal operation)
  │
  ├── step failure (1, 2, 3...)
  │
  ▼
OPEN (after maxFailures reached)
  │
  ├── resetMs elapsed
  │
  ▼
HALF-OPEN (one probe step allowed)
  │
  ├── probe succeeds → CLOSED
  └── probe fails   → OPEN (timer resets)
```

## Behaviour Details

- `consecutiveFailures` resets to 0 on any successful step.
- When `openedAt + resetMs <= Date.now()`, the circuit resets and one step is allowed to execute (half-open probe).
- If the probe fails, the circuit opens again immediately.
- Circuit state is **per-builder-instance** — different flows have independent breakers.

## Tips

- Combine with `retries` on individual steps for local retry before the global circuit counts a failure.
- For per-API rate limiting, consider `withRateLimit` instead.
