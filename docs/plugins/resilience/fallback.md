# withFallback

Catches any step error and calls a fallback function instead of propagating the error. The flow continues normally after the fallback executes.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withFallback } from "flowneer/plugins/resilience";

FlowBuilder.use(withFallback);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withFallback(async (s) => {
    const err = s.__fallbackError!;
    console.error(`Step ${err.stepIndex} failed: ${err.message}`);
    s.result = "default value";
  })
  .startWith(async (s) => {
    s.result = await riskyOperation(s); // might throw
  })
  .then((s) => {
    console.log(s.result); // either the real result or "default value"
  });
```

## API

### `.withFallback(fn: NodeFn<S, P>)`

The fallback function receives the same `(shared, params)` signature as a regular step. After it completes, execution continues with the **next step** in the flow as if nothing failed.

## `__fallbackError` Context

When a step fails, `withFallback` stores error context on `shared.__fallbackError` before calling your fallback function:

```typescript
interface FallbackError {
  stepIndex: number;
  stepType: string;
  message: string;
  stack?: string;
}
```

```typescript
.withFallback(async (s) => {
  if (s.__fallbackError?.stepType === "fn") {
    s.usedFallback = true;
  }
})
```

## Notes

- The fallback applies globally — all steps in the flow will use it if they fail.
- `InterruptError` is **not** caught by `withFallback` — it propagates normally.
- Combine with `withHistory` or `withAuditLog` to track which steps triggered fallbacks.
- For per-step error handling without a global fallback, use the `onError` hook in a custom plugin.
