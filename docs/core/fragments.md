# Fragments

Fragments are reusable, composable partial flows — the Flowneer equivalent of Zod partials. Define a step chain once, then splice it into any number of flows with `.add()`.

## Creating a Fragment

Use the `fragment<S, P>()` factory function. It returns a `Fragment` instance that supports the full fluent API: `.then()`, `.loop()`, `.batch()`, `.branch()`, `.parallel()`, `.anchor()`.

```typescript
import { fragment } from "flowneer";

const enrich = fragment<MyState>().then(fetchUser).then(enrichProfile);

const summarise = fragment<MyState>().loop(
  (s) => !s.done,
  (b) => b.then(summarize),
);
```

Fragments are typed — `Fragment<S, P>` carries the same shared-state and params types as `FlowBuilder<S, P>`, giving you full type safety when composing flows.

---

## Embedding with `.add()`

Call `.add(fragment)` on any `FlowBuilder` to splice the fragment's steps inline at that position:

```typescript
import { FlowBuilder, fragment } from "flowneer";

const flow = new FlowBuilder<MyState>()
  .then(init)
  .add(enrich) // enrich's steps are inlined here
  .add(summarise) // summarise's steps follow
  .then(finalize);

await flow.run(shared);
```

This is equivalent to manually chaining every step from the fragment — `.add()` just copies them in order.

---

## Reuse Across Flows

The same fragment instance can be `.add()`-ed into multiple flows without conflict. Steps are copied by reference (same semantics as `loop` / `batch` inner builders).

```typescript
const validate = fragment<State>().then(checkInput).then(sanitize);

const flowA = new FlowBuilder<State>().add(validate).then(handleA);
const flowB = new FlowBuilder<State>().add(validate).then(handleB);
```

---

## Fragments Cannot Run Directly

Calling `.run()` or `.stream()` on a `Fragment` throws an error:

```typescript
const frag = fragment().then(myStep);

await frag.run({}); // ❌ Error: Fragment cannot be run directly — use .add()
```

This is by design — fragments are building blocks, not standalone flows. Always embed them via `.add()`.

---

## All Step Types Supported

Fragments can contain any step type:

```typescript
const complex = fragment<State>()
  .then(stepA)
  .branch((s) => s.mode, {
    fast: stepFast,
    slow: stepSlow,
  })
  .loop(
    (s) => !s.done,
    (b) => b.then(iterate),
  )
  .batch(
    (s) => s.items,
    (b) => b.then(processItem),
  )
  .parallel([workerA, workerB])
  .anchor("checkpoint");
```

When `.add(complex)` is called, all of these steps are inlined into the parent flow and execute as if they were defined directly on it.

---

## Composing Fragments

Fragments can `.add()` other fragments, enabling layered composition:

```typescript
const auth = fragment<State>().then(authenticate).then(authorize);
const enrich = fragment<State>().then(fetchProfile).then(loadPrefs);

const setup = fragment<State>().add(auth).add(enrich);

const flow = new FlowBuilder<State>().add(setup).then(handleRequest);
```

---

## API Reference

### `fragment<S, P>()`

Factory function that creates a new `Fragment<S, P>`.

```typescript
import { fragment } from "flowneer";
const frag = fragment<MyState>();
```

### `Fragment<S, P>`

Class extending `FlowBuilder<S, P>`. Inherits all builder methods. Overrides `.run()` and `.stream()` to throw.

### `.add(frag)`

Method on `FlowBuilder` that splices all steps from `frag` into the current flow.

| Parameter | Type                | Description                           |
| --------- | ------------------- | ------------------------------------- |
| `frag`    | `FlowBuilder<S, P>` | A fragment (or FlowBuilder) to inline |

Returns `this` for chaining.
