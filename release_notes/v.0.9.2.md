# v0.9.2

## `withGraph` rewritten as a native DAG step type

The graph plugin's execution model has been fully rearchitected. Previously
`.compile()` translated the declared graph into a flat sequence of `.then()`,
`.anchor()`, and goto-returning steps. The DAG structure was erased at compile
time leaving no record of it at runtime.

Graphs are now compiled into a single `DagStep` descriptor that is pushed onto
the step list. A dedicated `"dag"` step type handler — registered via
`CoreFlowBuilder.registerStepType` with `{ transparent: true }` — traverses
the topologically-sorted node list at runtime, fires per-node lifecycle hooks
natively, and handles cycles via index arithmetic instead of anchor strings.

### What changed

|                          | v0.9.1                                             | v0.9.2                                          |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| `compile()` emits        | N `fn` steps + `anchor` steps + goto-fn steps      | **1 `DagStep` descriptor**                      |
| Cycle handling           | `.anchor()` labels + `return "#name"` goto strings | `i = positionOf.get(target)`                    |
| Middleware per node      | Worked (nodes became plain `fn` steps)             | Works natively — handler fires hooks explicitly |
| DAG structure at runtime | Erased at compile time                             | Preserved in `this.steps`                       |
| `compile()` size         | ~90 lines of translation logic                     | ~15 lines                                       |

### Per-node lifecycle hooks

Every registered middleware (`withTiming`, `withRateLimit`, `withTokenBudget`,
`withAuditLog`, etc.) now fires once per graph node — exactly as it would for a
plain `.then()` step. Node labels set via `NodeOptions.label` are passed through
`StepMeta` so label-scoped filters work correctly inside a DAG.

```typescript
const AppFlow = FlowBuilder.extend([withGraph, withTiming, withRateLimit]);

const flow = new AppFlow<MyState>()
  .withTiming()
  .withRateLimit({ intervalMs: 200 }, ["llm:*"])
  .addNode("llm:call", callLlm, { label: "llm:call" })
  .addNode("llm:validate", validateOutput, { label: "llm:validate" })
  .addNode("save", persist)
  .addEdge("llm:call", "llm:validate")
  .addEdge("llm:validate", "save")
  .compile();
```

`withTiming` fires for all three nodes; `withRateLimit` fires only for
`"llm:call"` and `"llm:validate"` — the same filter semantics as any other
step type.

---

## `CoreFlowBuilder.registerStepType` — `transparent` option

`registerStepType` now accepts a third `options` argument:

```typescript
CoreFlowBuilder.registerStepType(type, handler, { transparent: true });
```

When `transparent: true`, the step type is added to an internal set of
_transparent_ step types. `_execute` invokes transparent handlers directly,
bypassing the outer `beforeStep` / `wrapStep` / `afterStep` guards. The handler
is then responsible for firing per-item lifecycle hooks itself.

Use this when building step types that orchestrate multiple sub-operations
(like a DAG traversal, a saga, a supervisor loop) and want each sub-operation
— not the container — to participate in the middleware chain.

```typescript
CoreFlowBuilder.registerStepType(
  "my-supervisor",
  async (step, ctx) => {
    for (const task of step.tasks) {
      const meta = { index: ctx.meta.index, type: "fn", label: task.name };
      for (const h of ctx.hooks.beforeStep)
        await h(meta, ctx.shared, ctx.params);
      await task.run(ctx.shared, ctx.params);
      for (const h of ctx.hooks.afterStep)
        await h(meta, ctx.shared, ctx.params);
    }
  },
  { transparent: true },
);
```

---

## New `DagStep` type exported from core

`DagStep<S, P>` is now a first-class member of the `Step` union and is
exported from both `flowneer` and `flowneer/src`:

```typescript
import type { DagStep } from "flowneer";
```

`"dag"` is also added to the discriminated union in `StepMeta["type"]`, so
tooling that switches on step types (exporters, inspectors, debuggers) can
handle DAG steps explicitly.

---

## New example: `examples/graph/dagExample.ts`

A standalone runnable example covering all three core DAG patterns:

1. **Linear pipeline** — nodes run in topological dependency order
2. **Conditional forward edge** — a skip-ahead edge bypasses a node when a condition fires (e.g. cache hit)
3. **Conditional back-edge** — a loop edge retries an earlier node until a condition is satisfied
4. **Per-node middleware** — demonstrates `withTiming` firing once per graph node

```
bun run examples/graph/dagExample.ts
```
