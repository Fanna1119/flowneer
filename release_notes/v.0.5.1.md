# v0.5.1

## Overview

v0.5.1 extends the streaming API introduced in v0.5.0 with native generator step support and refactors the core into a maintainable `src/` module layout.

---

## Enhanced: generator steps (`async function*`)

Steps can now be declared as `async function*` generators. Each `yield` is forwarded to `flow.stream()` consumers as a `chunk` event — no `emit()` helper or manual `shared.__stream` assignment needed. The generator's final `return` value is still used for `#anchor` routing, so all existing routing patterns work unchanged.

```typescript
import { FlowBuilder } from "flowneer";

const flow = new FlowBuilder<State>()
  .startWith(async function* (s) {
    for await (const token of llmStream(s.prompt)) {
      s.response += token;
      yield token; // → chunk event on flow.stream()
    }
  })
  .then((s) => {
    console.log("Full response:", s.response);
  });

for await (const event of flow.stream(shared)) {
  if (event.type === "chunk") process.stdout.write(event.data as string);
  if (event.type === "done") break;
}
```

**Routing from a generator step** works the same as from a plain step — `return "#anchorName"` jumps to the named anchor:

```typescript
.startWith(async function* (s) {
  yield { type: "progress", pct: 50 };
  if (s.needsRetry) return "#retry"; // routes to anchor
})
.anchor("retry")
.then(retryStep)
```

**Without a stream consumer**, generator steps still run correctly and mutate shared state normally — `yield` values are silently dropped when no `flow.stream()` subscriber is active.

---

## Improved: `.stream()` pipeline fidelity

`chunk` events from generator steps are now emitted in the correct order relative to `step:before` / `step:after` events. The `step:after` event for a generator step fires only once the generator has fully completed (i.e. after the last `yield`).

---

## Internal: source split into `src/`

The core `Flowneer.ts` has been refactored into focused modules under `src/` for easier maintenance. All existing import paths (`from "flowneer"`, `from "../../Flowneer"`, etc.) are unchanged — `Flowneer.ts` remains as a barrel re-export. A new `src/index.ts` barrel is also available:

| File                 | Contents                                 |
| -------------------- | ---------------------------------------- |
| `src/types.ts`       | All public exported types and interfaces |
| `src/steps.ts`       | Internal step shape interfaces           |
| `src/errors.ts`      | `FlowError`, `InterruptError`            |
| `src/FlowBuilder.ts` | `FlowBuilder` class                      |
| `src/index.ts`       | Barrel re-export of all public API       |

---

## Migration

No breaking changes. No import updates required.
