# v0.4.0 Release Notes

## Bug Fixes

### `batch()` — nested batch namespace collision fixed

Previously all `batch()` steps wrote the current item to the hardcoded `shared.__batchItem` key. Nesting two `batch()` calls would cause the inner batch to overwrite the outer batch's item, making the outer item inaccessible inside the inner processor.

**Before:**

```ts
// outer's __batchItem was lost inside the inner batch
flow.batch(
  (s) => s.users,
  (b) =>
    b.batch(
      (s) => s.__batchItem.posts,
      (inner) =>
        inner.startWith((s) => {
          // s.__batchItem is now a Post — the User is gone
        }),
    ),
);
```

**After:** pass a `{ key }` option to give each batch level its own property name.

```ts
flow.batch(
  (s) => s.users,
  (b) =>
    b
      .startWith((s) => {
        /* s.__user is the current User */
      })
      .batch(
        (s) => s.__user!.posts,
        (inner) =>
          inner.startWith((s) => {
            // both s.__user (User) and s.__post (Post) are accessible
            console.log(s.__user, s.__post);
          }),
        { key: "__post" },
      ),
  { key: "__user" },
);
```

The `key` option defaults to `"__batchItem"` so existing code is fully backward-compatible.

### Improved restore behaviour

The save/restore logic for the batch item key was changed to use `Object.prototype.hasOwnProperty` instead of an `=== undefined` check. This means a property explicitly set to `undefined` on `shared` before the batch runs is now correctly preserved after the batch completes.

## Performance Improvements

### Hook array caching

Previously, every step execution rebuilt hook wrapper arrays via `.map().filter()` on `_hooksList`, allocating new arrays on every step even when hooks never changed. Hook arrays are now built once and cached; the cache is invalidated only when a new plugin is registered via `_setHooks()`. This reduces allocations significantly in flows that run many steps or use `.batch()` / `.loop()` over large datasets.

### `_retry` fast path for `times === 1`

The default retry count is `1` (no retries). Previously even a non-retrying step entered the `while`/`try`/`catch` loop. A direct `return fn()` fast path is now taken when `times === 1`, removing unnecessary overhead for the common case.

### Anchor pre-scan skipped when no anchors are present

The `_execute` method previously scanned all steps to build a `labels` map on every invocation, including sub-flows inside `.batch()` and `.loop()`. The scan is now skipped entirely when the step list contains no `.anchor()` steps.

### Dangling `setTimeout` in `_withTimeout` cleared

The timeout promise previously left its `setTimeout` handle alive after the wrapped function resolved. The handle is now cleared via `.finally(() => clearTimeout(timer))`, preventing unnecessary GC pressure and avoiding interference in test environments with fake timers.

## Minor Improvements

- The `idleTimeout` option was added to the Bun server in the streaming server example to prevent idle connections from hanging indefinitely. The timeout is set to 60 seconds.

## Breaking Changes

### `label()` renamed to `anchor()` — goto prefix changed from `→` to `#`

The `.label(name)` method has been renamed to `.anchor(name)` and the goto return prefix has been changed from `"→"` to `"#"`, which is more intuitive (like an HTML anchor link).

**Before:**

```ts
flow.label("refine").then((s) => {
  if (s.quality < 0.8) return "→refine";
});
```

**After:**

```ts
flow.anchor("refine").then((s) => {
  if (s.quality < 0.8) return "#refine";
});
```

**Migration:** replace all `.label(` → `.anchor(` and all `return "→` → `return "#` in your flows.
