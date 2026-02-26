# Errors

Flowneer wraps step failures in structured error types so you can distinguish flow errors from unexpected runtime errors and handle them appropriately.

## `FlowError`

Thrown when a step (or sub-flow) fails after all retries are exhausted.

```typescript
import { FlowError } from "flowneer";

try {
  await flow.run(shared);
} catch (err) {
  if (err instanceof FlowError) {
    console.error(`Flow failed at: ${err.step}`); // e.g. "step 2" or "batch (step 1)"
    console.error(`Caused by:`, err.cause); // the original error
  }
}
```

### Properties

| Property  | Type      | Description                                                     |
| --------- | --------- | --------------------------------------------------------------- |
| `step`    | `string`  | Human-readable step label, e.g. `"step 2"`, `"branch (step 0)"` |
| `cause`   | `unknown` | The original error that caused the failure                      |
| `message` | `string`  | `"Flow failed at {step}: {cause.message}"`                      |

### Step Labels

| Step type  | Label format          |
| ---------- | --------------------- |
| `fn`       | `"step N"`            |
| `branch`   | `"branch (step N)"`   |
| `loop`     | `"loop (step N)"`     |
| `batch`    | `"batch (step N)"`    |
| `parallel` | `"parallel (step N)"` |

---

## `InterruptError`

Thrown intentionally to **pause** a flow mid-execution — not a failure. Used by `interruptIf` and `humanNode` to implement human-in-the-loop and approval gates.

```typescript
import { InterruptError } from "flowneer";

try {
  await flow.run(shared);
} catch (err) {
  if (err instanceof InterruptError) {
    const savedState = err.savedShared; // deep clone of shared at interrupt time
    // save to DB, prompt user, etc.
    const userInput = await promptUser(savedState.__humanPrompt);
    // resume the flow
    await resumeFlow(flow, savedState, { feedback: userInput }, resumeFromStep);
  }
}
```

### Properties

| Property      | Type      | Description                                                           |
| ------------- | --------- | --------------------------------------------------------------------- |
| `savedShared` | `unknown` | Deep clone (`JSON.parse/stringify`) of shared state at interrupt time |
| `message`     | `string`  | `"Flow interrupted"`                                                  |

`InterruptError` is **never wrapped** in a `FlowError` — it propagates directly so callers can catch it cleanly.

---

## `onError` Hook

Plugins and callbacks can listen for step errors without stopping the flow via the `onError` hook:

```typescript
this._setHooks({
  onError: (meta, error, shared) => {
    console.error(`Step ${meta.index} failed:`, error);
    shared.lastError = error instanceof Error ? error.message : String(error);
  },
});
```

`onError` fires **before** the error is propagated — it's informational, not a recovery mechanism. To recover, use [`withFallback`](../plugins/resilience/fallback.md).

---

## Error Handling Patterns

### Retry on failure

```typescript
.then(riskyStep, { retries: 3, delaySec: 2 })
```

### Fallback on failure

```typescript
FlowBuilder.use(withFallback);
flow.withFallback(async (s) => {
  s.result = s.__fallbackError.message;
  // flow continues normally after this
});
```

### Circuit breaker

```typescript
FlowBuilder.use(withCircuitBreaker);
flow.withCircuitBreaker({ maxFailures: 3, resetMs: 30_000 });
```

### Timeout

```typescript
FlowBuilder.use(withTimeout);
flow.withTimeout(5000); // 5 s per step
// or per-step:
.then(slowStep, { timeoutMs: 10_000 })
```
