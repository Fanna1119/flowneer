# withTryCatch

Structured try / catch / finally blocks for flow steps. Wraps one or more steps in an exception-safe block without reaching for top-level error handlers.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withTryCatch } from "flowneer/plugins/resilience";

FlowBuilder.use(withTryCatch);
```

## Usage

```typescript
import { FlowBuilder, fragment } from "flowneer";
import { withTryCatch } from "flowneer/plugins/resilience";

FlowBuilder.use(withTryCatch);

const flow = new FlowBuilder<State>()
  .try(fragment<State>().then(fetchData).then(processData))
  .catch(
    fragment<State>().then((s) => {
      console.error("Pipeline failed:", s.__tryError);
      s.result = "fallback";
    }),
  )
  .finally(fragment<State>().then(cleanup))
  .then(sendResult);
```

## API

### `.try(fragment)`

Executes all steps in `fragment`. If any step throws, control passes to the `.catch()` fragment (if registered), or the error propagates.

### `.catch(fragment)`

Handles an error thrown inside the preceding `.try()`. The error is available on `shared.__tryError` before the fragment runs and is removed once the fragment completes.

If the catch fragment also throws, the error propagates (and the `.finally()` fragment still runs).

### `.finally(fragment)`

Always runs after the `.try()` (and optional `.catch()`), regardless of success or failure. Calling `.finally()` closes the try/catch block.

> **Note:** `.catch()` and `.finally()` must be called **immediately** after `.try()` — no other `.then()` or builder calls can appear between them.

## `__tryError` context

The caught error is stored on `shared.__tryError` inside the catch fragment:

```typescript
.catch(
  fragment<State>().then((s) => {
    const err = s.__tryError; // original Error or value that was thrown

    if (err instanceof Error) {
      s.errorMessage = err.message;
    }

    s.usedFallback = true;
  }),
)
```

`__tryError` is always the **original** thrown value. If Flowneer wrapped it in a `FlowError`, the unwrapped cause is exposed here.

## Nested blocks

Try/catch blocks can be nested:

```typescript
const flow = new FlowBuilder<State>()
  .try(
    fragment<State>()
      .try(fragment<State>().then(riskyInner))
      .catch(
        fragment<State>().then((s) => {
          s.innerFailed = true;
        }),
      )
      .then(continueFrag),
  )
  .catch(
    fragment<State>().then((s) => {
      s.outerFailed = true;
    }),
  );
```

## Example — fetch with recovery

```typescript
import { FlowBuilder, fragment } from "flowneer";
import { withTryCatch } from "flowneer/plugins/resilience";

FlowBuilder.use(withTryCatch);

interface State {
  userId: string;
  profile: Record<string, unknown> | null;
  fromCache: boolean;
}

const flow = new FlowBuilder<State>()
  .try(
    fragment<State>().then(async (s) => {
      const res = await fetch(`/api/users/${s.userId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      s.profile = await res.json();
    }),
  )
  .catch(
    fragment<State>().then(async (s) => {
      console.warn("Live fetch failed, loading from cache:", s.__tryError);
      s.profile = await loadFromCache(s.userId);
      s.fromCache = true;
    }),
  )
  .then((s) => {
    console.log("Profile ready, fromCache:", s.fromCache);
  });
```
