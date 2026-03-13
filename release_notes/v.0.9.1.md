# v0.9.1

## StepFilter support across all lifecycle plugins

Every plugin that registers lifecycle hooks now accepts an optional `filter` parameter — a
`StepFilter` (label-glob array or predicate function) that scopes the plugin's behaviour to
matching steps only. Previously only `withDebugger` and `withRateLimit` supported this.

### Affected plugins

| Category      | Plugin                    | New signature                                        |
| ------------- | ------------------------- | ---------------------------------------------------- |
| Observability | `withTiming`              | `withTiming(filter?)`                                |
| Observability | `withHistory`             | `withHistory(filter?)`                               |
| Observability | `withVerbose`             | `withVerbose(filter?)`                               |
| LLM           | `withCostTracker`         | `withCostTracker(filter?)`                           |
| LLM           | `withTokenBudget`         | `withTokenBudget(limit, filter?)`                    |
| LLM           | `withStructuredOutput`    | `withStructuredOutput(validator, options?, filter?)` |
| Resilience    | `withFallback`            | `withFallback(fn, filter?)`                          |
| Resilience    | `withTimeout`             | `withTimeout(ms, filter?)`                           |
| Persistence   | `withAuditLog`            | `withAuditLog(store, filter?)`                       |
| Persistence   | `withCheckpoint`          | `withCheckpoint(store, filter?)`                     |
| Persistence   | `withVersionedCheckpoint` | `withVersionedCheckpoint(store, filter?)`            |

All changes are **non-breaking** — `filter` is always the last, optional parameter.

### Usage

```typescript
const AppFlow = FlowBuilder.extend([
  withTiming,
  withTokenBudget,
  withTimeout,
  withAuditLog,
]);

const flow = new AppFlow<MyState>()
  // Only time LLM steps
  .withTiming(["llm:*"])
  // Enforce token budget only on LLM steps — other steps don't count
  .withTokenBudget(50_000, ["llm:*"])
  // 5 s timeout for LLM steps, 30 s for external API calls
  .withTimeout(5_000, ["llm:*"])
  .withTimeout(30_000, ["api:*"])
  // Only audit PII-touching steps
  .withAuditLog(auditStore, ["pii:*"])
  .then(callLlm, { label: "llm:generate" })
  .then(callApi, { label: "api:fetch" })
  .then(saveResult, { label: "pii:save" });
```

Multiple `withTimeout` calls with different filters compose correctly — each timeout
wrapper passes through non-matching steps transparently by calling `next()`, preserving
the full middleware chain.

---

## `CustomStepConfig` type for `JsonFlowBuilder` custom step types

Registering a custom step type via `JsonFlowBuilder.registerStepBuilder()` previously
required an `as FlowConfig` cast to use the config object without a TypeScript error,
because the custom `type` string was not assignable to the `StepConfig` union.

A new `CustomStepConfig` escape-hatch has been added to `schema.ts` and unioned into
`StepConfig`. Custom step configs no longer require any casting.

```typescript
// Before — required an unsafe cast
const config = {
  steps: [{ type: "log", message: "hello" }],
} as FlowConfig;

// After — assignable directly
const config: FlowConfig = {
  steps: [{ type: "log", message: "hello" }],
};
```

Built-in step types (`fn`, `branch`, `loop`, `batch`, `parallel`, `anchor`) are still
fully type-checked — `CustomStepConfig` is the last member of the union and only matches
`type` strings that are not one of the six built-in literals.

---

## Plugin method collision detection in `FlowBuilder.extend()`

`extend()` now throws immediately if two plugins declare the same method name, or if a
plugin method collides with an existing method on the base class prototype.

```typescript
const pA = { map() {} };
const pB = { map() {} };

FlowBuilder.extend([pA, pB]);
// throws: Plugin method collision: "map"
```

Previously the second plugin silently overwrote the first, producing hard-to-trace bugs.

---

## Docs

- `docs/presets/config/overview.md` — expanded to document the `FlowClass` third argument
  to `build()`, the full `registerStepBuilder()` parameter table including `recurse`, a
  new "Using plugins" section with a compliance auditing example, split loop examples
  (condition-based vs anchor/goto), a "Types" reference section, and expanded notes.
