# withRateLimit

Enforces a minimum interval between consecutive step executions. Useful when calling rate-limited APIs (LLM providers, external services, etc.) to avoid `429 Too Many Requests` errors.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withRateLimit } from "flowneer/plugins/llm";

FlowBuilder.use(withRateLimit);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withRateLimit({ intervalMs: 1000 }) // at least 1 s between steps
  .startWith(callLlmStep)
  .then(callLlmStep)
  .then(callLlmStep);
```

## Options

| Option       | Type     | Required | Description                                                        |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| `intervalMs` | `number` | ✅       | Minimum milliseconds between end of one step and start of the next |

## Behaviour

- Measures elapsed time from when the **previous step ended**.
- If the elapsed time is less than `intervalMs`, waits for the remainder.
- The first step is never delayed.
- Multiple `withRateLimit` registrations are stacked — both limits are applied.

## Example: Batching with Rate Limit

```typescript
const flow = new FlowBuilder<State>()
  .withRateLimit({ intervalMs: 500 }) // 2 requests/s max
  .batch(
    (s) => s.prompts,
    (b) =>
      b.startWith(async (s) => {
        s.results.push(await callLlm(s.__batchItem as string));
      }),
  );
```

> **Note:** The rate limit applies between each step execution globally, not just between LLM calls. For per-call throttling inside a step, implement that in your LLM utility function.
