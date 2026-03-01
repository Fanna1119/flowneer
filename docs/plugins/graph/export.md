````markdown
# Graph & Flow Export

Two plugins let you serialise a flow's structure to JSON for debugging, visualisation, or documentation generation.

| Plugin            | Works on          | Returns                              |
| ----------------- | ----------------- | ------------------------------------ |
| `withExportGraph` | Graph flows only  | `GraphExport` (nodes + edges)        |
| `withExportFlow`  | Any `FlowBuilder` | `FlowExport` (flow + optional graph) |

Load `withExportFlow` last — it overrides `.exportGraph()` with the richer unified shape.

---

## `withExportGraph`

Exports the raw nodes and edges declared via `addNode` / `addEdge` **before** `.compile()` is called. The call is non-destructive — `.compile()` can still be chained after.

### Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withGraph, withExportGraph } from "flowneer/plugins/graph";

FlowBuilder.use(withGraph);
FlowBuilder.use(withExportGraph);
```

### Usage

```typescript
const result = new FlowBuilder<State>()
  .addNode("fetch", fetchData, { retries: 3 })
  .addNode("transform", transformData)
  .addNode("save", saveData)
  .addEdge("fetch", "transform")
  .addEdge("transform", "save")
  .addEdge("transform", "fetch", (s) => s.needsRetry) // conditional back-edge
  .exportGraph(); // ← non-destructive

console.log(JSON.stringify(result, null, 2));
```

```json
{
  "format": "json",
  "nodes": [
    { "name": "fetch", "options": { "retries": 3 } },
    { "name": "transform" },
    { "name": "save" }
  ],
  "edges": [
    { "from": "fetch", "to": "transform", "conditional": false },
    { "from": "transform", "to": "save", "conditional": false },
    { "from": "transform", "to": "fetch", "conditional": true }
  ]
}
```

### `GraphExport` type

```typescript
interface GraphExport {
  format: "json";
  nodes: GraphNodeExport[];
  edges: GraphEdgeExport[];
}

interface GraphNodeExport {
  name: string;
  options?: {
    retries?: number | string; // "<dynamic>" when a function
    delaySec?: number | string;
    timeoutMs?: number | string;
  };
}

interface GraphEdgeExport {
  from: string;
  to: string;
  conditional: boolean; // true when the edge has a runtime guard
}
```

### Notes

- Options with value `0` (the default) are omitted from the output.
- Dynamic option values (functions) are serialised as `"<dynamic>"`.
- Calling `.exportGraph()` on a builder with no nodes throws an error.
- The `"mermaid"` format is reserved for a future release.

---

## `withExportFlow`

Exports **any** `FlowBuilder` — sequential, loop, batch, parallel, branch — into a structured node/edge graph. When loaded alongside `withGraph`, also includes the raw graph store in a separate `graph` section.

Loading `withExportFlow` after `withExportGraph` is fine — it overrides `.exportGraph()` at runtime.

### Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withExportFlow } from "flowneer/plugins/graph";
// Optionally also load withGraph + withExportGraph for the combined output:
// FlowBuilder.use(withGraph);
// FlowBuilder.use(withExportGraph);
FlowBuilder.use(withExportFlow); // load last
```

### Usage — sequential flow

```typescript
const result = new FlowBuilder<State>()
  .startWith(loadData)
  .then(validate)
  .then(save)
  .exportGraph();
```

```json
{
  "format": "json",
  "flow": {
    "nodes": [
      { "id": "fn_0", "type": "fn", "label": "loadData" },
      { "id": "fn_1", "type": "fn", "label": "validate" },
      { "id": "fn_2", "type": "fn", "label": "save" }
    ],
    "edges": [
      { "from": "fn_0", "to": "fn_1", "kind": "sequential" },
      { "from": "fn_1", "to": "fn_2", "kind": "sequential" }
    ]
  }
}
```

### Usage — flow with complex steps

```typescript
const result = new FlowBuilder<State>()
  .startWith(init)
  .loop(
    (s) => !s.done,
    (b) => b.startWith(process).then(check),
  )
  .parallel([workerA, workerB, workerC])
  .exportGraph();
```

Loop and parallel bodies get nested `id` paths (e.g. `"loop_1:body:fn_0"`) so the full structure is unambiguous.

### Usage — graph + flow combined

When `withGraph`, `withExportGraph`, and `withExportFlow` are all loaded:

```typescript
const result = new FlowBuilder<State>()
  .addNode("a", stepA)
  .addNode("b", stepB)
  .addEdge("a", "b")
  .exportGraph(); // before compile() — includes both sections
```

```json
{
  "format": "json",
  "flow": { "nodes": [], "edges": [] },
  "graph": {
    "nodes": [{ "name": "a" }, { "name": "b" }],
    "edges": [{ "from": "a", "to": "b", "conditional": false }]
  }
}
```

After `.compile()` the flow section is populated; the graph section is still present.

### `FlowExport` type

```typescript
interface FlowExport {
  format: "json";
  flow: {
    nodes: FlowNodeExport[];
    edges: FlowEdgeExport[];
  };
  graph?: {
    // present only when a graph store is attached
    nodes: GraphNodeExport[];
    edges: GraphEdgeExport[];
  };
}

interface FlowNodeExport {
  id: string; // e.g. "fn_0", "loop_2", "loop_2:body:fn_1"
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  label: string; // function name, anchor name, or "anonymous"
  options?: {
    retries?: number | string;
    delaySec?: number | string;
    timeoutMs?: number | string;
  };
  meta?: Record<string, unknown>; // branch keys, parallel count, etc.
}

interface FlowEdgeExport {
  from: string;
  to: string;
  kind:
    | "sequential"
    | "branch-arm"
    | "loop-body"
    | "loop-back"
    | "parallel-fan-out"
    | "batch-body";
  label?: string; // branch key or parallel index
}
```

### Node `id` conventions

| Step type  | `id` pattern                    |
| ---------- | ------------------------------- |
| `fn`       | `fn_<index>`                    |
| `branch`   | `branch_<index>`                |
| branch arm | `branch_<index>:arm:<key>`      |
| `loop`     | `loop_<index>`                  |
| loop body  | `loop_<index>:body:<child-id>`  |
| `batch`    | `batch_<index>`                 |
| batch body | `batch_<index>:body:<child-id>` |
| `parallel` | `parallel_<index>`              |
| `anchor`   | `anchor:<name>`                 |

---

## See also

- [Graph Composition](./overview.md) — `addNode`, `addEdge`, `compile()`
````
