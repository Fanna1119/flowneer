# v0.6.0

## Overview

v0.6.0 introduces **Fragments** — reusable, composable partial flows inspired by Zod's partials. Fragments let you define step chains once and splice them into any number of flows, keeping complex orchestrations DRY and modular.

---

## New: `Fragment` class & `fragment()` factory

A `Fragment<S, P>` is a partial flow that supports the full fluent API (`.then()`, `.loop()`, `.batch()`, `.branch()`, `.parallel()`, `.anchor()`) but **cannot be executed directly**. Calling `.run()` or `.stream()` on a fragment throws with a clear error message — fragments are building blocks, not standalone flows.

Create fragments with the `fragment()` factory function:

```typescript
import { FlowBuilder, fragment } from "flowneer";

const enrich = fragment<MyState>().then(fetchUser).then(enrichProfile);

const summarise = fragment<MyState>().loop(
  (s) => !s.done,
  (b) => b.then(summarize),
);
```

---

## New: `.add(fragment)` method on `FlowBuilder`

Splice a fragment's steps into any flow at the call site with `.add()`. Steps are inlined in order — the flow continues normally after the last fragment step.

```typescript
const flow = new FlowBuilder<MyState>()
  .then(init)
  .add(enrich) // splices enrich's steps here
  .add(summarise) // splices summarise's steps here
  .then(finalize);

await flow.run(shared);
```

Fragments are reusable — the same fragment instance can be `.add()`-ed into multiple flows without conflict:

```typescript
const common = fragment<State>().then(validateInput).then(logRequest);

const flowA = new FlowBuilder<State>().add(common).then(handleA);
const flowB = new FlowBuilder<State>().add(common).then(handleB);
```

All step types are supported inside fragments — `.loop()`, `.batch()`, `.branch()`, `.parallel()`, and `.anchor()` all work as expected when spliced into the parent flow.

---

## Internal

- `FlowBuilder.steps` visibility changed from `private` to `protected` to support `.add()` reading fragment steps.
- New file: `src/Fragment.ts` — `Fragment` class and `fragment()` factory.
- `Fragment` and `fragment` are exported from all barrel files (`src/index.ts`, `Flowneer.ts`, `index.ts`).

---

## Migration

No breaking changes. All existing flows, plugins, and import paths work unchanged.
