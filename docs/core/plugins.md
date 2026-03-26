# Writing Plugins

Plugins extend `FlowBuilder` with new methods by registering **lifecycle hooks**. They are the primary extension mechanism in Flowneer.

## Plugin Shape

A plugin is an object whose keys become methods on `FlowBuilder.prototype`:

```typescript
import type { FlowneerPlugin, PluginContext } from "flowneer";

export const myPlugin: FlowneerPlugin = {
  myMethod(this: PluginContext, arg: string) {
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

const AppFlow = FlowBuilder.extend([myPlugin]);

// Now available on all AppFlow instances:
new AppFlow<State>().myMethod("prefix").startWith(step);
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

## StepFilter — scoping hooks to specific steps

Step-scoped hooks (`beforeStep`, `afterStep`, `onError`, `wrapStep`, `wrapParallelFn`) accept an optional `StepFilter` as the **second argument** to `_setHooks()`. Hooks without a filter run on every step. `beforeFlow` and `afterFlow` are unaffected by filters.

```typescript
type StepFilter = string[] | ((meta: StepMeta) => boolean);
```

### String array — label matching with glob wildcards

Pass an array of step labels. The `*` character is a glob wildcard: `"llm:*"` matches `"llm:summarise"`, `"llm:embed"`, etc. Steps that have no label are **never matched** by a positive string filter.

```typescript
(this as any)._setHooks(
  {
    beforeStep: (meta, shared) => {
      console.log("LLM step starting:", meta.label);
    },
  },
  ["llm:*", "embed:*"], // only fires for steps whose label matches
);
```

### Negation — exclude steps with `!`

Prefix any pattern with `!` to exclude matching steps. **Negation veto always wins** over a positive match in the same array.

```typescript
// Negation-only — apply everywhere except human-in-loop steps
this._setHooks({ wrapStep: rateLimiter }, ["!human:*"]);

// Mixed — apply to llm steps but never human steps
this._setHooks({ wrapStep: rateLimiter }, ["!human:*", "llm:*"]);

// Negation veto beats a matching wildcard in the same array
this._setHooks(
  { beforeStep: log },
  ["!llm:generate", "llm:*"], // fires on all llm:* except llm:generate
);
```

**Unlabelled steps and negation:** negation patterns require a label to match against. An unlabelled step cannot be vetoed, so it is included by a negation-only filter (but still excluded by a positive-pattern filter).

### Predicate — runtime condition or multi-criteria logic

Pass a function that receives `StepMeta` and returns `true` to match:

```typescript
this._setHooks(
  { wrapStep: rateLimitedWrap },
  (meta) => meta.label?.startsWith("llm:") ?? false,
);
```

### Auto-`next()` for unmatched `wrapStep` / `wrapParallelFn`

When a `wrapStep` or `wrapParallelFn` hook is filtered out for a particular step, Flowneer automatically calls `next()` on its behalf. **The middleware chain is never broken** by a filter.

### `addHooks(hooks, filter?)` — dynamic hook registration

End users (outside of a plugin) can register hooks at runtime via `addHooks`:

```typescript
const dispose = flow.addHooks(
  { beforeStep: (meta) => console.log("->", meta.label) },
  ["llm:*"],
);

await flow.run(shared);

dispose(); // removes the hooks
```

`addHooks` accepts the same `StepFilter` second argument as `_setHooks` and returns a `dispose()` function to remove the registered hooks.

## Complete Plugin Example

```typescript
import { FlowBuilder } from "flowneer";
import type { FlowneerPlugin, PluginContext, StepMeta } from "flowneer";

declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withRetryLog(prefix?: string): this;
  }
}

export const withRetryLog: FlowneerPlugin = {
  withRetryLog(this: PluginContext, prefix = "[retry]") {
    this._setHooks({
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
const AppFlow = FlowBuilder.extend([withRetryLog]);
const flow = new AppFlow();
flow.withRetryLog("MyApp").startWith(riskyStep, { retries: 3 });
```
