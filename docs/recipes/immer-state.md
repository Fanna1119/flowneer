# Immer State

Use [Immer](https://immerjs.github.io/immer/) drafts as Flowneer's `shared` object to get structural sharing, immutable snapshots, per-run patches, and time-travel — with zero changes to your step functions.

Flowneer's engine passes `shared` by reference and never freezes, clones, or structurally inspects it. An Immer draft is a Proxy that looks and behaves like a plain object, so it passes straight through.

**Dependencies:** `immer`

---

## Basic pattern

Wrap `flow.run()` inside `produce`. Immer hands a mutable draft to your callback; when it resolves, Immer finalises the draft into a new immutable object via structural sharing.

```typescript
import { produce } from "immer";
import { FlowBuilder } from "flowneer";

interface AppState {
  userId: string;
  user: { name: string; plan: string } | null;
  invoices: { id: string; amount: number }[];
  total: number;
}

const flow = new FlowBuilder<AppState>()
  .startWith(async (s) => {
    s.user = await api.getUser(s.userId); // direct mutation — Immer tracks it
  })
  .then(async (s) => {
    s.invoices = await api.getInvoices(s.userId);
  })
  .then(async (s) => {
    s.total = s.invoices.reduce((sum, inv) => sum + inv.amount, 0);
  });

const initialState: AppState = {
  userId: "u_123",
  user: null,
  invoices: [],
  total: 0,
};

const nextState = await produce(initialState, async (draft) => {
  await flow.run(draft, {});
});

// nextState is a new immutable object; initialState is unchanged
console.log(nextState.total); // 420
console.log(nextState === initialState); // false
```

---

## Snapshots in `stream()`

`stream()` yields `{ meta, shared }` by reference. With a mutable draft, every
yielded object points to the same Proxy — by the time you read it, it may have
advanced. Use Immer's `current()` to freeze a snapshot at each yield:

```typescript
import { produce, current } from "immer";

const history: AppState[] = [];

await produce(initialState, async (draft) => {
  for await (const event of flow.stream(draft, {})) {
    if (event.type === "step:after") {
      // current() returns a plain frozen snapshot — safe to store
      history.push(current(event.shared as AppState));
    }
  }
});

// history[0] is the state after step 0; history[1] after step 1; etc.
```

---

## Tracking diffs with `produceWithPatches`

Use `produceWithPatches` to record exactly which paths each `run()` mutated.
Useful for audit logs, optimistic UI synchronisation, or sending minimal diffs
over the wire.

```typescript
import { produceWithPatches, applyPatches, enablePatches } from "immer";

enablePatches(); // required once at app startup

const [nextState, patches, inversePatches] = await produceWithPatches(
  initialState,
  async (draft) => {
    await flow.run(draft, {});
  },
);

console.log("changed paths:", patches);
// [
//   { op: "replace", path: ["user"], value: { name: "Alice", plan: "pro" } },
//   { op: "replace", path: ["invoices"], value: [...] },
//   { op: "replace", path: ["total"], value: 420 },
// ]

// Undo the entire run:
const previousState = applyPatches(nextState, inversePatches);
```

---

## Map and Set support

If your state contains `Map` or `Set`, call `enableMapSet()` once before any
flow runs:

```typescript
import { enableMapSet } from "immer";
enableMapSet();

interface State {
  seen: Set<string>;
  cache: Map<string, unknown>;
}

const flow = new FlowBuilder<State>().startWith(async (s) => {
  s.seen.add("u_123"); // works with enableMapSet
  s.cache.set("u_123", { name: "Alice" });
});
```

---

## What you get

|                                            | Without Immer | With Immer |
| ------------------------------------------ | ------------- | ---------- |
| Structural sharing between runs            | ❌            | ✅         |
| Immutable snapshot after each run          | ❌            | ✅         |
| Per-run diff via patches                   | ❌            | ✅         |
| Undo / time-travel                         | ❌            | ✅         |
| Step function changes required             | —             | none       |
| Flowneer plugin or config changes required | —             | none       |
