# Writing Plugins

Plugins extend `FlowBuilder` with new methods by registering **lifecycle hooks**. They are the primary extension mechanism in Flowneer.

## Plugin Shape

A plugin is an object whose keys become methods on `FlowBuilder.prototype`:

```typescript
import type { FlowneerPlugin } from "flowneer";

export const myPlugin: FlowneerPlugin = {
  myMethod(this: FlowBuilder<any, any>, arg: string) {
    this._setHooks({
      beforeStep: (meta, shared) => {
        console.log(`[${arg}] step ${meta.index} starting`);
      },
    });
    return this; // always return `this` for chaining
  },
};
```

## Registering a Plugin

```typescript
import { FlowBuilder } from "flowneer";
import { myPlugin } from "./myPlugin";

FlowBuilder.use(myPlugin);

// Now available on all FlowBuilder instances:
new FlowBuilder<State>().myMethod("prefix").startWith(step);
```

## TypeScript Declaration Merging

Add the method to the `FlowBuilder` interface so TypeScript knows about it:

```typescript
declare module "flowneer" {
  interface FlowBuilder<S, P> {
    myMethod(arg: string): this;
  }
}
```

Place this in the same file as your plugin, or in a `*.d.ts` file.

## Available Lifecycle Hooks

Registered via `this._setHooks(hooks)`:

| Hook             | Signature                                                | Called                                         |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `beforeFlow`     | `(shared, params) => void`                               | Once before the first step                     |
| `afterFlow`      | `(shared, params) => void`                               | Once after the last step                       |
| `beforeStep`     | `(meta, shared, params) => void`                         | Before each step body                          |
| `afterStep`      | `(meta, shared, params) => void`                         | After each step body                           |
| `wrapStep`       | `(meta, next, shared, params) => Promise<void>`          | Wraps step execution — call `next()` to run it |
| `wrapParallelFn` | `(meta, fnIndex, next, shared, params) => Promise<void>` | Wraps each function in a `.parallel()` step    |
| `onError`        | `(meta, error, shared, params) => void`                  | Called when a step throws                      |

### `wrapStep` — Middleware

`wrapStep` is the most powerful hook. It wraps step execution so you can run code **before and after**, handle errors, or skip steps entirely (dry-run, mock, etc.).

```typescript
wrapStep: async (meta, next, shared, params) => {
  console.log("before", meta.index);
  try {
    await next(); // ← executes the step body
  } catch (err) {
    console.error("step failed", err);
    throw err; // re-throw to propagate
  }
  console.log("after", meta.index);
};
```

Omit `next()` to skip the step:

```typescript
wrapStep: async (_meta, _next) => {
  // dry-run: step body never runs
};
```

Multiple `wrapStep` registrations are **composed innermost-first** — the last registered wraps the outermost.

## Multiple Hook Registrations

Calling `_setHooks` multiple times stacks — each call adds a new entry. The `beforeFlow`/`afterStep`/etc. handlers all run in registration order.

## Complete Plugin Example

```typescript
import { FlowBuilder } from "flowneer";
import type { FlowneerPlugin, StepMeta } from "flowneer";

declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withRetryLog(prefix?: string): this;
  }
}

export const withRetryLog: FlowneerPlugin = {
  withRetryLog(this: FlowBuilder<any, any>, prefix = "[retry]") {
    (this as any)._setHooks({
      onError: (meta: StepMeta, err: unknown) => {
        console.warn(
          `${prefix} step ${meta.index} (${meta.type}) failed:`,
          err instanceof Error ? err.message : err,
        );
      },
    });
    return this;
  },
};

// Usage:
FlowBuilder.use(withRetryLog);
flow.withRetryLog("MyApp").startWith(riskyStep, { retries: 3 });
```
