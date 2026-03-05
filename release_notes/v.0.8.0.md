# v0.8.0

## New feature: `StepFilter` — scope plugins and hooks to specific steps

Plugins and raw hooks can now be restricted to a subset of steps via an optional
`filter` parameter on `addHooks()` / `_setHooks()`. Step-scoped hooks
(`beforeStep`, `afterStep`, `onError`, `wrapStep`, `wrapParallelFn`) only fire
when the filter matches. `beforeFlow` / `afterFlow` are unaffected.

### `StepFilter` type

```typescript
type StepFilter = string[] | ((meta: StepMeta) => boolean);
```

- **String array** — fires only for steps whose `label` matches an entry in
  the list. Entries are exact strings **or** glob patterns where `*` matches
  any substring (e.g. `"llm:*"` matches `"llm:summarise"`, `"llm:embed"`, …).
  Steps without a label are never matched.
- **Predicate** — full control; return `true` to match. Use this for prefix
  patterns, type-based matching, or any other condition.

Unmatched `wrapStep` / `wrapParallelFn` hooks always call `next()` automatically,
so the middleware chain is never broken regardless of filtering.

### `addHooks` — optional `filter` parameter

```typescript
const dispose = flow.addHooks(
  { beforeStep: log, afterStep: record },
  ["callLlm", "callEmbeddings"], // only these labels
);
```

```typescript
// Predicate — match by prefix convention
flow.addHooks(
  { beforeStep: log },
  (meta) => meta.label?.startsWith("llm:") ?? false,
);
```

### `withRateLimit` — optional `filter` parameter

```typescript
// Rate-limit every step (previous behaviour, unchanged)
flow.withRateLimit({ intervalMs: 500 });

// Rate-limit only named LLM steps
flow.withRateLimit({ intervalMs: 1000 }, ["callLlm", "callEmbeddings"]);

// Rate-limit all steps whose label starts with "llm:"
flow.withRateLimit(
  { intervalMs: 1000 },
  (meta) => meta.label?.startsWith("llm:") ?? false,
);
```

### Wildcard / prefix matching

The array form supports `*` as a glob wildcard (matches any substring):

```typescript
// Matches "llm:summarise", "llm:embed", "llm:anything", …
flow.withRateLimit({ intervalMs: 1000 }, ["llm:*"]);

// Multiple patterns
flow.addHooks({ beforeStep: log }, ["llm:*", "embed:*"]);
```

For more complex logic (type-based matching, dynamic conditions, etc.) use the
predicate form:

```typescript
flow.addHooks(
  { beforeStep: log },
  (meta) => (meta.label?.startsWith("llm:") ?? false) && someRuntimeFlag,
);
```

### How it works

`applyStepFilter` is applied at **registration time** in `_setHooks`, wrapping
each hook function with a guard closure. The execution engine (`_execute`) is
unchanged — filtering adds zero overhead to the hot loop for unfiltered hooks.

### New export: `StepFilter`

`StepFilter` is now exported from both `flowneer` and `flowneer/src`:

```typescript
import type { StepFilter } from "flowneer";
```

Useful when authoring plugins that want to accept a filter parameter:

```typescript
import type { FlowBuilder, FlowneerPlugin, StepFilter } from "flowneer";

export const withMyPlugin: FlowneerPlugin = {
  withMyPlugin(this: FlowBuilder<any, any>, filter?: StepFilter) {
    (this as any)._setHooks({ beforeStep: myHook }, filter);
    return this;
  },
};
```

## New example: `examples/stepFilter.ts`

Self-contained example (no API key required) demonstrating all three patterns:
array filter, predicate filter, and `addHooks` with a filter. Run with:

```
bun run examples/stepFilter.ts
```
