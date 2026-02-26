# Step Types

Flowneer provides six built-in step primitives. Every step in a flow is one of these types.

## `fn` — Plain step

Created by `.startWith()` and `.then()`. The workhorse of most flows.

```typescript
flow
  .startWith(async (s) => {
    s.fetchedData = await fetch(s.url).then((r) => r.json());
  })
  .then(async (s) => {
    s.processed = transform(s.fetchedData);
  });
```

**Return value routing:** If a `fn` step returns a string beginning with `#`, it's treated as a goto jump to a named anchor:

```typescript
.then(async (s) => {
  if (s.needsRetry) return "#retry"; // jump to the anchor named "retry"
})
```

**Async generator steps:** A step declared as `async function*` yields token chunks and returns an optional routing string:

```typescript
.then(async function* (s) {
  for await (const token of streamLlm(s.prompt)) {
    s.response += token;
    yield token;           // → forwarded as a "chunk" event to .stream()
  }
  // optionally: return "#anchorName"
})
```

---

## `branch` — Conditional routing

Created by `.branch()`. A router function returns a key; the matching branch function executes.

```typescript
flow.branch(
  (s) => s.intent, // "buy" | "refund" | anything else → "default"
  {
    buy: handleBuy,
    refund: handleRefund,
    default: handleGeneral,
  },
);
```

- If the router returns a key not in `branches`, the `"default"` branch (if present) runs.
- The `retries` / `delaySec` options apply to both the router and the selected branch function.
- Branch functions can return `"#anchorName"` for goto.

---

## `loop` — While loop

Created by `.loop()`. Runs the inner flow body repeatedly while the condition holds.

```typescript
flow.loop(
  (s) => !s.isDone,
  (b) =>
    b.startWith(async (s) => {
      const result = await pollApi(s.jobId);
      s.isDone = result.status === "complete";
    }),
);
```

The condition is checked **before** each body execution (pre-condition loop). Hook middleware (`wrapStep`, etc.) does **not** wrap the entire loop — it wraps each step within the body individually.

---

## `batch` — Sequential item processing

Created by `.batch()`. Runs the inner flow for each item from `items`.

```typescript
flow.batch(
  (s) => s.emails, // extract list from shared state
  (b) =>
    b.startWith(async (s) => {
      const email = s.__batchItem as Email;
      await sendEmail(email);
    }),
);
```

Key behaviour:

- Items are processed **sequentially** (not in parallel — use `.parallel()` for that).
- The current item is stored on `shared[key]` (defaults to `"__batchItem"`).
- The `key` property is cleaned up from `shared` after the batch completes.
- Nested batches require distinct `key` values to avoid collisions.

---

## `parallel` — Concurrent execution

Created by `.parallel()`. Runs all provided functions concurrently with `Promise.all`.

```typescript
flow.parallel([
  async (s) => {
    s.a = await fetchA();
  },
  async (s) => {
    s.b = await fetchB();
  },
  async (s) => {
    s.c = await fetchC();
  },
]);
```

**Safe mode (with reducer):** Each function operates on its own shallow draft. The reducer merges drafts back into `shared` after all complete — safe against concurrent write races:

```typescript
flow.parallel([workerA, workerB], undefined, (shared, [draftA, draftB]) => {
  shared.results = [...(draftA.results ?? []), ...(draftB.results ?? [])];
});
```

The `retries` and `delaySec` options apply per-function.

---

## `anchor` — Named jump target

Created by `.anchor()`. A pure no-op marker — nothing executes at an anchor step. Its only purpose is to provide a goto target.

```typescript
flow
  .anchor("start")
  .then(async (s) => {
    s.count++;
    if (s.count < 5) return "#start"; // loop back
  })
  .then(finalize);
```

Anchors are automatically detected before flow execution. Jumping to a non-existent anchor throws `Error: goto target anchor "name" not found`.

---

## NodeOptions

All `fn`, `branch`, and `parallel` steps accept `NodeOptions`:

```typescript
interface NodeOptions<S, P> {
  retries?: NumberOrFn<S, P>; // total attempts, default 1
  delaySec?: NumberOrFn<S, P>; // seconds between retries, default 0
  timeoutMs?: NumberOrFn<S, P>; // per-step timeout ms, default 0 (disabled)
}
```

`NumberOrFn` means you can pass a plain number or a `(shared, params) => number` callback for dynamic resolution:

```typescript
.then(step, {
  retries:  (s) => (s.isHighPriority ? 5 : 2),
  timeoutMs: 10_000,
})
```
