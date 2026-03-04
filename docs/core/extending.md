# Extending Flowneer

Flowneer has four distinct extension points. Choosing the right one depends on
what you're building and how broadly it should apply.

| Mechanism                               | Scope                   | Use for                                           |
| --------------------------------------- | ----------------------- | ------------------------------------------------- |
| `FlowBuilder.use(plugin)`               | All instances, globally | Adding new builder methods (e.g. `withTiming()`)  |
| `flow.with([plugins])`                  | One specific instance   | Per-flow configuration (hooks, rate limits, etc.) |
| `CoreFlowBuilder.registerStepType(...)` | All instances, globally | New first-class step types                        |
| `flow.add(fragment)`                    | One specific flow       | Composing reusable partial flows                  |

---

## `FlowBuilder.use(plugin)` — prototype plugin

Adds new **methods** to every `FlowBuilder` instance by patching the prototype.
This is the standard mechanism for publishable plugins.

```typescript
import { FlowBuilder } from "flowneer";
import type { FlowneerPlugin } from "flowneer";

export const withTiming: FlowneerPlugin = {
  withTiming(this: FlowBuilder<any, any>) {
    const starts = new Map<number, number>();
    (this as any)._setHooks({
      beforeStep: (meta) => {
        starts.set(meta.index, performance.now());
      },
      afterStep: (meta) => {
        console.log(
          `step ${meta.index} took ${performance.now() - starts.get(meta.index)!}ms`,
        );
      },
    });
    return this;
  },
};

// Register once at startup — available on every instance afterwards
FlowBuilder.use(withTiming);
```

Add TypeScript types via declaration merging:

```typescript
declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withTiming(): this;
  }
}
```

Then use it on any instance:

```typescript
new FlowBuilder<State>().withTiming().then(step).run(shared);
```

::: tip When to use this
Publish as an npm package, or register once in your app's bootstrap file.
Methods become available everywhere without any per-instance setup.
:::

---

## `flow.with([plugins])` — instance plugin

Applies configuration to **one specific flow instance** without touching other
instances. Takes an `InstancePlugin`, which is a plain function that receives the
builder and registers hooks on it.

```typescript
import type { InstancePlugin } from "flowneer";

function withRateLimit(rps: number): InstancePlugin<any> {
  return (flow) => {
    const interval = 1000 / rps;
    flow.addHooks({
      beforeStep: async () => {
        await new Promise((r) => setTimeout(r, interval));
      },
    });
  };
}
```

Use it in a chain:

```typescript
new FlowBuilder<State>()
  .with([withRateLimit(10), withTiming()])
  .then(callApi)
  .run(shared);
```

Or apply to an existing instance:

```typescript
const flow = new FlowBuilder<State>().then(callApi);
flow.with(withRateLimit(10));
await flow.run(shared);
```

::: tip When to use this
Use `with()` when plugin settings vary per flow (e.g. different rate limits on
different pipelines), or when you don't want to patch the global prototype.
:::

### Difference from `FlowBuilder.use()`

|             | `FlowBuilder.use(plugin)`                   | `flow.with([plugins])`               |
| ----------- | ------------------------------------------- | ------------------------------------ |
| **Type**    | `FlowneerPlugin` — an object of methods     | `InstancePlugin` — a setup function  |
| **Effect**  | Patches `FlowBuilder.prototype` permanently | Registers hooks on one instance      |
| **Scope**   | All instances, present and future           | Only this instance                   |
| **Purpose** | Adding new builder methods                  | Configuring hooks on a specific flow |

---

## `CoreFlowBuilder.registerStepType()` — custom step type

Registers a completely new step type into the global dispatch table. The handler
receives the step descriptor and a `StepContext` with `shared`, `params`,
`signal`, `hooks`, and `builder`.

Return `undefined` to continue, or an anchor name (without `#`) to goto.

```typescript
import { CoreFlowBuilder, FlowBuilder } from "flowneer";
import type { StepHandler, StepContext } from "flowneer";

// 1. Define the handler
const sleepHandler: StepHandler = async (step, ctx) => {
  await new Promise((r) => setTimeout(r, step.ms));
  return undefined;
};

// 2. Register it (once at startup)
CoreFlowBuilder.registerStepType("sleep", sleepHandler);

// 3. Add a builder method that pushes the step descriptor
FlowBuilder.use({
  sleep(this: any, ms: number) {
    this.steps.push({ type: "sleep", ms });
    return this;
  },
});
```

TypeScript types:

```typescript
declare module "flowneer" {
  interface FlowBuilder<S, P> {
    sleep(ms: number): this;
  }
}
```

Usage:

```typescript
new FlowBuilder<State>()
  .then(fetchData)
  .sleep(500) // ← new step type
  .then(processData)
  .run(shared);
```

::: tip Accessing `builder` in the handler
`ctx.builder` is the `CoreFlowBuilder` instance. Use `ctx.builder._runSub()` to
run a nested flow, or `ctx.builder._execute()` if you have a sub-flow built from
a step descriptor (as `loop` and `batch` do internally).
:::

---

## `flow.add(fragment)` — composing fragments

Fragments are reusable partial flows. Build one with the `fragment()` factory
and splice it into any flow with `.add()`.

```typescript
import { fragment, FlowBuilder } from "flowneer";

const enrich = fragment<State>().then(fetchUser).then(enrichProfile);

const summarise = fragment<State>().loop(
  (s) => !s.done,
  (b) => b.then(summarize),
);

new FlowBuilder<State>()
  .then(init)
  .add(enrich) // splices enrich's steps in-place
  .add(summarise)
  .then(finalize)
  .run(shared);
```

Fragments cannot be `.run()` or `.stream()` directly — they are composable
building blocks only.

::: tip When to use this
Use fragments to share **step sequences** between flows. Use `with()` to share
**hook behaviour**. Use `FlowBuilder.use()` to share **builder methods**.
:::
