# Extending Flowneer

Flowneer has four distinct extension points. Choosing the right one depends on
what you're building and how broadly it should apply.

| Mechanism                               | Scope                   | Use for                                          |
| --------------------------------------- | ----------------------- | ------------------------------------------------ |
| `FlowBuilder.extend([plugins])`         | Subclass, not global    | Adding new builder methods (e.g. `withTiming()`) |
| `CoreFlowBuilder.registerStepType(...)` | All instances, globally | New first-class step types                       |
| `flow.add(fragment)`                    | One specific flow       | Composing reusable partial flows                 |

---

## `FlowBuilder.extend([plugins])` — subclass plugin

Creates an isolated **subclass** of `FlowBuilder` with new methods mixed in.
This is the standard mechanism for publishable plugins — it never mutates the
base class.

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

// Create a subclass — never touches FlowBuilder.prototype
const AppFlow = FlowBuilder.extend([withTiming]);
```

Add TypeScript types via declaration merging:

```typescript
declare module "flowneer" {
  interface FlowBuilder<S, P> {
    withTiming(): this;
  }
}
```

Then use it on any `AppFlow` instance:

```typescript
new AppFlow<State>().withTiming().then(step).run(shared);
```

Chain `extend()` to layer plugins:

```typescript
const BaseFlow = FlowBuilder.extend([withTiming]);
const AppFlow = BaseFlow.extend([withRateLimit]); // has both
```

::: tip When to use this
Publish as an npm package, or create your project's `AppFlow` once and import it
everywhere. Methods become available on all instances of the subclass without
affecting the base `FlowBuilder` or other subclasses.
:::

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
const AppFlow = FlowBuilder.extend([
  {
    sleep(this: any, ms: number) {
      this.steps.push({ type: "sleep", ms });
      return this;
    },
  },
]);
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
Use fragments to share **step sequences** between flows. Use `FlowBuilder.extend()` to share **builder methods**.
:::
