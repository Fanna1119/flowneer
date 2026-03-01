// ---------------------------------------------------------------------------
// Graph-based composition plugin
// ---------------------------------------------------------------------------
// Declarative DAG API that compiles down to the existing FlowBuilder DSL.
//
//   flow
//     .addNode("fetch", fetchData)
//     .addNode("transform", transformData)
//     .addNode("save", saveData)
//     .addEdge("fetch", "transform")
//     .addEdge("transform", "save")
//     .addEdge("transform", "fetch", (s) => s.needsRetry)  // conditional back-edge
//     .compile();
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { FlowneerPlugin, NodeFn, NodeOptions } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNode<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  fn: NodeFn<S, P>;
  options?: NodeOptions<S, P>;
}

export interface GraphEdge<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  from: string;
  to: string;
  /** If provided, the edge is only followed when the condition returns true. */
  condition?: (shared: S, params: P) => boolean | Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Add a named node to the graph.
     *
     * Nodes are not executed at registration time — call `.compile()` to
     * produce an executable `FlowBuilder`.
     */
    addNode(name: string, fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this;

    /**
     * Add a directed edge between two nodes.
     *
     * @param from      Source node name.
     * @param to        Target node name.
     * @param condition Optional guard — when provided the edge is only
     *                  followed if the condition returns `true`.
     *                  Conditional edges enable cycles (back-edges).
     */
    addEdge(
      from: string,
      to: string,
      condition?: (shared: S, params: P) => boolean | Promise<boolean>,
    ): this;

    /**
     * Compile the registered nodes + edges into an executable flow.
     *
     * The compiler performs a topological sort on unconditional edges,
     * detects back-edges (cycles) and compiles them as `.anchor()` +
     * conditional goto, and produces a fully wired `FlowBuilder`.
     *
     * The resulting builder is returned for further chaining or `.run()`.
     */
    compile(): this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological sort + back-edge detection
// ─────────────────────────────────────────────────────────────────────────────

interface CompileResult {
  /** Topologically sorted node names. */
  order: string[];
  /** Edges that point backwards in the topological order (cycles). */
  backEdges: GraphEdge[];
  /** Forward conditional edges (not back-edges). */
  conditionalForward: GraphEdge[];
}

function compileGraph(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): CompileResult {
  // Separate unconditional forward edges for topo sort
  const unconditional = edges.filter((e) => !e.condition);
  const conditional = edges.filter((e) => !!e.condition);

  // Build adjacency list from unconditional edges
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const name of nodes.keys()) {
    adj.set(name, []);
    inDegree.set(name, 0);
  }
  for (const e of unconditional) {
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const next of adj.get(node) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Check for unresolved nodes — they form cycles among unconditional edges
  if (order.length !== nodes.size) {
    const missing = [...nodes.keys()].filter((n) => !order.includes(n));
    throw new Error(
      `Graph has cycles among unconditional edges involving: ${missing.join(", ")}. ` +
        `Use conditional edges to break cycles.`,
    );
  }

  // Classify conditional edges
  const positionOf = new Map<string, number>();
  order.forEach((name, i) => positionOf.set(name, i));

  const backEdges: GraphEdge[] = [];
  const conditionalForward: GraphEdge[] = [];
  for (const e of conditional) {
    const fromPos = positionOf.get(e.from) ?? -1;
    const toPos = positionOf.get(e.to) ?? -1;
    if (toPos <= fromPos) {
      backEdges.push(e);
    } else {
      conditionalForward.push(e);
    }
  }

  return { order, backEdges, conditionalForward };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin implementation
// ─────────────────────────────────────────────────────────────────────────────

export { withExportGraph } from "./withExportGraph";
export type {
  ExportFormat,
  GraphExport,
  GraphNodeExport,
  GraphEdgeExport,
} from "./withExportGraph";

// withExportFlow is intentionally NOT re-exported here.
// Import it explicitly when you want the unified FlowBuilder export:
//   import { withExportFlow } from "flowneer/plugins/graph/withExportFlow";
// This keeps withExportFlow's module augmentation isolated so it only
// activates when the plugin is deliberately loaded.

export const withGraph: FlowneerPlugin = {
  addNode(
    this: FlowBuilder<any, any>,
    name: string,
    fn: NodeFn,
    options?: NodeOptions,
  ) {
    const store = _getGraphStore(this);
    if (store.nodes.has(name)) {
      throw new Error(`Graph node "${name}" already exists`);
    }
    store.nodes.set(name, { name, fn, options });
    return this;
  },

  addEdge(
    this: FlowBuilder<any, any>,
    from: string,
    to: string,
    condition?: (shared: any, params: any) => boolean | Promise<boolean>,
  ) {
    const store = _getGraphStore(this);
    store.edges.push({ from, to, condition });
    return this;
  },

  compile(this: FlowBuilder<any, any>) {
    const store = _getGraphStore(this);
    const { nodes, edges } = store;

    if (nodes.size === 0) {
      throw new Error("Cannot compile an empty graph");
    }

    // Validate edges reference existing nodes
    for (const e of edges) {
      if (!nodes.has(e.from))
        throw new Error(`Edge references unknown node "${e.from}"`);
      if (!nodes.has(e.to))
        throw new Error(`Edge references unknown node "${e.to}"`);
    }

    const { order, backEdges, conditionalForward } = compileGraph(nodes, edges);

    // Build a set of back-edge targets (need anchors)
    const backEdgeTargets = new Set(backEdges.map((e) => e.to));

    // Build conditional forward edge map: from → [{ to, condition }]
    const condFwd = new Map<
      string,
      Array<{ to: string; condition: NonNullable<GraphEdge["condition"]> }>
    >();
    for (const e of conditionalForward) {
      if (!condFwd.has(e.from)) condFwd.set(e.from, []);
      condFwd.get(e.from)!.push({ to: e.to, condition: e.condition! });
    }

    // Build back-edge map: from → [{ to, condition }]
    const backMap = new Map<
      string,
      Array<{ to: string; condition: NonNullable<GraphEdge["condition"]> }>
    >();
    for (const e of backEdges) {
      if (!backMap.has(e.from)) backMap.set(e.from, []);
      backMap.get(e.from)!.push({ to: e.to, condition: e.condition! });
    }

    // Emit the compiled flow
    for (let i = 0; i < order.length; i++) {
      const name = order[i]!;
      const node = nodes.get(name)!;

      // Place anchor if this node is a back-edge target
      if (backEdgeTargets.has(name)) {
        this.anchor(`__graph_${name}`);
      }

      // Emit the node step
      if (i === 0 && !(this as any).steps?.length) {
        this.startWith(node.fn, node.options);
      } else {
        this.then(node.fn, node.options);
      }

      // Emit conditional forward jumps (skip-ahead)
      const fwdEdges = condFwd.get(name);
      if (fwdEdges) {
        for (const { to, condition } of fwdEdges) {
          this.then(async (shared: any, params: any) => {
            if (await condition(shared, params)) {
              return `#__graph_${to}`;
            }
          });
          // The target needs an anchor too
          backEdgeTargets.add(to);
        }
      }

      // Emit back-edge gotos (cycles)
      const backs = backMap.get(name);
      if (backs) {
        for (const { to, condition } of backs) {
          this.then(async (shared: any, params: any) => {
            if (await condition(shared, params)) {
              return `#__graph_${to}`;
            }
          });
        }
      }
    }

    // Clean up graph store
    delete (this as any).__graphStore;

    return this;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal graph store (attached to instance)
// ─────────────────────────────────────────────────────────────────────────────

interface GraphStore {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

function _getGraphStore(builder: any): GraphStore {
  if (!builder.__graphStore) {
    builder.__graphStore = {
      nodes: new Map(),
      edges: [],
    };
  }
  return builder.__graphStore;
}
