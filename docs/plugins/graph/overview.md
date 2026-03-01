# Graph Composition

Declare flows as directed acyclic graphs (DAGs) with `addNode` and `addEdge`, then call `compile()` to produce an executable `FlowBuilder`. Cycles are supported via conditional back-edges, which compile into anchor-based goto jumps.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withGraph } from "flowneer/plugins/graph";

FlowBuilder.use(withGraph);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .addNode("fetch", fetchData)
  .addNode("validate", validateData)
  .addNode("transform", transformData)
  .addNode("save", saveData)
  .addEdge("fetch", "validate")
  .addEdge("validate", "transform")
  .addEdge("transform", "save")
  // Conditional back-edge: loop back to fetch if retry needed
  .addEdge("validate", "fetch", (s) => s.needsRetry)
  .compile();

await flow.run({ url: "https://api.example.com/data", needsRetry: false });
```

## API

### `.addNode(name, fn, options?)`

Register a named node. Nodes are not executed at registration time.

| Parameter | Type                | Description                      |
| --------- | ------------------- | -------------------------------- |
| `name`    | `string`            | Unique node name                 |
| `fn`      | `NodeFn<S, P>`      | Step function                    |
| `options` | `NodeOptions<S, P>` | Optional retries, delay, timeout |

### `.addEdge(from, to, condition?)`

Add a directed edge between nodes.

| Parameter   | Type                                              | Description      |
| ----------- | ------------------------------------------------- | ---------------- |
| `from`      | `string`                                          | Source node name |
| `to`        | `string`                                          | Target node name |
| `condition` | `(shared, params) => boolean \| Promise<boolean>` | Optional guard   |

Conditional edges enable **cycles** (back-edges). Unconditional edges form the DAG skeleton.

### `.compile()`

Topologically sorts the unconditional edges and compiles the graph into an executable flow:

1. Runs Kahn's algorithm to find the topological order.
2. Detects back-edges and compiles them as `.anchor()` + conditional goto.
3. Inserts `.anchor()` + routing step for each back-edge.
4. Returns `this` for chaining.

**Throws** if unconditional edges form a cycle — use conditional edges to break any cycle.

## How Compilation Works

Given a graph `A → B → C` with a back-edge `C → A (conditional)`:

```
compile() produces:
  .anchor("A")
  .then(nodeA_fn)
  .then(nodeB_fn)
  .then(nodeC_fn)
  .then(async (s, p) => { if (condition(s, p)) return "#A"; })
```

## Full Example

```typescript
interface ProcessState {
  data: any[];
  valid: boolean;
  needsRetry: boolean;
  retries: number;
}

const flow = new FlowBuilder<ProcessState>()
  .addNode("load", (s) => {
    s.data = loadData();
  })
  .addNode("validate", (s) => {
    s.valid = s.data.every(isValid);
    s.needsRetry = !s.valid;
  })
  .addNode("process", async (s) => {
    s.data = await process(s.data);
  })
  .addNode("save", async (s) => {
    await saveData(s.data);
  })
  .addEdge("load", "validate")
  .addEdge("validate", "process")
  .addEdge("process", "save")
  // Retry up to 3 times if validation fails
  .addEdge("validate", "load", (s) => s.needsRetry && ++s.retries < 3)
  .compile()
  .withCycles(3, "load"); // guard against infinite retry loops
```

## Notes

- All nodes must have at least one incoming edge except the starting node (in-degree 0).
- Unreachable nodes are included in the compiled flow if they appear in `addNode()` but not reachable from a root.
- `compile()` mutates the builder in place and returns `this`.

## See also

- [Graph & Flow Export](./export.md) — `withExportGraph` and `withExportFlow`
