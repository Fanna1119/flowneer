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

---

## New plugin: Compliance (`plugins/compliance/`)

Statically audit and runtime-enforce data-boundary rules on flows.

### `withAuditFlow` — static taint analysis

Walks the compiled `steps[]` array without executing anything and checks that no
"sink" step (e.g. an outbound call) appears after a "source" step (e.g. a PII
fetch) for each supplied `TaintRule`.

```typescript
import { FlowBuilder } from "flowneer";
import { withAuditFlow } from "flowneer/plugins/compliance";

FlowBuilder.use(withAuditFlow);

const report = flow.auditFlow([
  {
    source: ["pii:*"],
    sink: (meta) => meta.label?.startsWith("external:") ?? false,
    message: "PII must not reach external endpoints",
  },
]);

if (!report.passed) throw new Error("Compliance check failed");
```

### `withRuntimeCompliance` — hook-based runtime checks

Installs inspectors that examine shared state before each step. Responses can be
configured per-inspector: `"throw"` (default), `"warn"`, or `"record"`.

```typescript
import {
  withRuntimeCompliance,
  scanShared,
  ComplianceError,
} from "flowneer/plugins/compliance";

FlowBuilder.use(withRuntimeCompliance);

flow.withRuntimeCompliance([
  {
    filter: (meta) => meta.label?.startsWith("external:") ?? false,
    check: (shared) => {
      const hits = scanShared(shared, ["user.email"]);
      return hits.length > 0 ? `PII found before external call` : null;
    },
    onViolation: "throw",
  },
]);
```

### `scanShared` — PII detection helper

Walks a shared object and returns fields matching built-in PII patterns
(email, phone, SSN, IPv4, credit card). Detection-agnostic core — bring your
own patterns via the inspector `check` function.

```typescript
import { scanShared } from "flowneer/plugins/compliance";

const hits = scanShared(shared);
// [{ path: "user.email", pattern: "email", value: "alice@example.com" }]
```

---

## New plugin: `withFlowAnalyzer` (`plugins/dev/`)

Two tools for understanding flow structure and execution paths.

### `.analyzeFlow()` — static path map

Synchronous walk of `steps[]`; returns a `PathMap` with all nodes, anchor names,
and a flag indicating whether runtime gotos are possible.

```typescript
import { withFlowAnalyzer } from "flowneer/plugins/dev";

FlowBuilder.use(withFlowAnalyzer);

const map = flow.analyzeFlow();
console.log(map.anchors); // ["refine"]
console.log(map.hasDynamicGotos); // true
console.log(map.nodes.map((n) => n.label));
```

### `.withTrace()` — runtime execution trace

Installs `beforeStep`/`afterStep` hooks; returns `{ getTrace(), dispose() }`.
Composable with `withDryRun` to trace path structure without side effects.

```typescript
const trace = flow.withTrace();
await flow.run(shared);
console.log(trace.getTrace().pathSummary); // ["fetch:user", "enrich", "save"]
trace.dispose();
```

---

## New plugin: `JsonFlowBuilder` (`plugins/config/`)

Build and validate `FlowBuilder` instances from a plain JSON configuration.
Supports all step types (`fn`, `branch`, `loop`, `batch`, `parallel`, `anchor`)
plus extension via `registerStepBuilder`.

```typescript
import { JsonFlowBuilder } from "flowneer/plugins/config";

const config = {
  steps: [
    { type: "fn", fn: "fetchUser", label: "pii:user", retries: 2 },
    {
      type: "branch",
      router: "route",
      branches: { pass: "save", fail: "retry" },
    },
    { type: "anchor", name: "retry", maxVisits: 3 },
    { type: "fn", fn: "retryFetch" },
  ],
};

// Validate first (returns all errors without throwing)
const result = JsonFlowBuilder.validate(config, registry);
if (!result.valid) {
  result.errors.forEach((e) => console.error(`${e.path}: ${e.message}`));
}

// Build — throws ConfigValidationError if invalid
const flow = JsonFlowBuilder.build(config, registry);
await flow.run(shared);
```

### Custom step types

```typescript
JsonFlowBuilder.registerStepBuilder("myStep", (step, flow, registry) => {
  flow.then(registry[step.fn], { label: step.label });
});
```
