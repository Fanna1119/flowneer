// ---------------------------------------------------------------------------
// withExportFlow — unified flow + graph export
// ---------------------------------------------------------------------------
//
// Overrides `.exportGraph()` on any FlowBuilder (graph-compiled or plain
// sequential).  If the instance also has a `withGraph` store attached (i.e.
// `.addNode()` / `.addEdge()` were called before `.compile()`), a `graph`
// section is appended automatically.
//
//   FlowBuilder.use(withGraph);
//   FlowBuilder.use(withExportFlow);     // loads last — wins at runtime
//
//   // Plain sequential flow:
//   new FlowBuilder().then(a).then(b).exportGraph();
//   // → { format: "json", flow: { nodes: [...], edges: [...] } }
//
//   // Graph-first flow (before compile()):
//   new FlowBuilder().addNode("a", a).addEdge("a", "b").exportGraph();
//   // → { format: "json", flow: { nodes: [], edges: [] },
//   //     graph: { nodes: [...], edges: [...] } }
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import type {
  GraphNodeExport,
  GraphEdgeExport,
  ExportFormat,
} from "./withExportGraph";

// ─────────────────────────────────────────────────────────────────────────────
// Flow node / edge export types
// ─────────────────────────────────────────────────────────────────────────────

/** Metadata exported for a single step in a sequential flow. */
export interface FlowNodeExport {
  /** Unique id within this export: `"fn_0"`, `"branch_2"`, `"anchor:name"`, etc. */
  id: string;
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  /** Function name, anchor name, or `"anonymous"` for arrow functions. */
  label: string;
  /** Non-default step options. */
  options?: {
    retries?: number | string;
    delaySec?: number | string;
    timeoutMs?: number | string;
  };
  /** Type-specific supplementary data. */
  meta?: Record<string, unknown>;
}

export interface FlowEdgeExport {
  from: string;
  to: string;
  /** How this edge was derived. */
  kind:
    | "sequential"
    | "branch-arm"
    | "loop-body"
    | "loop-back"
    | "parallel-fan-out"
    | "batch-body";
  /** Branch key, parallel index, etc. */
  label?: string;
}

export interface FlowSection {
  nodes: FlowNodeExport[];
  edges: FlowEdgeExport[];
}

export interface GraphSection {
  nodes: GraphNodeExport[];
  edges: GraphEdgeExport[];
}

/** Root object returned by `.exportGraph()` when `withExportFlow` is loaded. */
export interface FlowExport {
  format: "json";
  flow: FlowSection;
  /** Present only when the builder also has an uncompiled graph store. */
  graph?: GraphSection;
}

// ─────────────────────────────────────────────────────────────────────────────
// Declaration merging — override exportGraph return type
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Export the full flow as a JSON-serialisable structure for debugging.
     *
     * Works on any `FlowBuilder` — sequential, loop, batch, branch, etc.
     * If the builder also has an uncompiled `withGraph` store (nodes + edges
     * added via `.addNode()` / `.addEdge()`), a `graph` section is included.
     *
     * Non-destructive — `.compile()` can still be called afterwards.
     *
     * @example
     * ```ts
     * const result = flow.exportGraph();
     * console.log(JSON.stringify(result, null, 2));
     * ```
     */
    exportGraph(format?: "json"): FlowExport;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — option serialisation
// ─────────────────────────────────────────────────────────────────────────────

function serOpt(val: unknown): number | string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val === 0 ? undefined : val;
  if (typeof val === "function") return "<dynamic>";
  return undefined;
}

function buildOptions(step: any): FlowNodeExport["options"] | undefined {
  const r = serOpt(step.retries);
  const d = serOpt(step.delaySec);
  const t = serOpt(step.timeoutMs);
  if (r === undefined && d === undefined && t === undefined) return undefined;
  return {
    ...(r !== undefined ? { retries: r } : {}),
    ...(d !== undefined ? { delaySec: d } : {}),
    ...(t !== undefined ? { timeoutMs: t } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step walker — builds flat nodes + edges lists, recursing into sub-flows
// ─────────────────────────────────────────────────────────────────────────────

function walkSteps(steps: any[], prefix: string = ""): FlowSection {
  const nodes: FlowNodeExport[] = [];
  const edges: FlowEdgeExport[] = [];
  let prevId: string | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // ── derive a stable id ──────────────────────────────────────────────────
    const rawId =
      step.type === "anchor" ? `anchor:${step.name}` : `${step.type}_${i}`;
    const id = prefix ? `${prefix}:${rawId}` : rawId;

    // ── sequential edge from previous step ──────────────────────────────────
    if (prevId !== null) {
      edges.push({ from: prevId, to: id, kind: "sequential" });
    }

    // ── build the node itself ────────────────────────────────────────────────
    switch (step.type as string) {
      case "fn": {
        nodes.push({
          id,
          type: "fn",
          label: step.fn?.name || "anonymous",
          options: buildOptions(step),
        });
        break;
      }

      case "branch": {
        const branchKeys = Object.keys(step.branches ?? {});
        nodes.push({
          id,
          type: "branch",
          label: step.router?.name || "router",
          options: buildOptions(step),
          meta: { branches: branchKeys },
        });
        // Fan-out: one arm per branch key
        for (const key of branchKeys) {
          const armId = `${id}:arm:${key}`;
          const armFn = step.branches[key];
          nodes.push({
            id: armId,
            type: "fn",
            label: armFn?.name || key,
          });
          edges.push({ from: id, to: armId, kind: "branch-arm", label: key });
        }
        break;
      }

      case "loop": {
        nodes.push({
          id,
          type: "loop",
          label: step.condition?.name || "condition",
        });
        // Recurse into loop body
        const bodySteps: any[] = (step.body as any)?.steps ?? [];
        const { nodes: bodyNodes, edges: bodyEdges } = walkSteps(
          bodySteps,
          `${id}:body`,
        );
        nodes.push(...bodyNodes);
        edges.push(...bodyEdges);
        // Connect: loop → first body step → loop (back-edge)
        const firstBody = bodyNodes[0]?.id;
        const lastBody = bodyNodes[bodyNodes.length - 1]?.id;
        if (firstBody)
          edges.push({ from: id, to: firstBody, kind: "loop-body" });
        if (lastBody) edges.push({ from: lastBody, to: id, kind: "loop-back" });
        break;
      }

      case "batch": {
        nodes.push({
          id,
          type: "batch",
          label: step.itemsExtractor?.name || "items",
          meta: { key: step.key ?? "__batchItem" },
        });
        // Recurse into processor
        const procSteps: any[] = (step.processor as any)?.steps ?? [];
        const { nodes: procNodes, edges: procEdges } = walkSteps(
          procSteps,
          `${id}:each`,
        );
        nodes.push(...procNodes);
        edges.push(...procEdges);
        const firstProc = procNodes[0]?.id;
        if (firstProc)
          edges.push({ from: id, to: firstProc, kind: "batch-body" });
        break;
      }

      case "parallel": {
        const fns: any[] = step.fns ?? [];
        nodes.push({
          id,
          type: "parallel",
          label: `parallel(${fns.length})`,
          options: buildOptions(step),
          meta: { count: fns.length },
        });
        // Fan-out: one node per parallel fn
        for (let fi = 0; fi < fns.length; fi++) {
          const fnId = `${id}:fn_${fi}`;
          nodes.push({
            id: fnId,
            type: "fn",
            label: fns[fi]?.name || `fn_${fi}`,
          });
          edges.push({
            from: id,
            to: fnId,
            kind: "parallel-fan-out",
            label: `fn_${fi}`,
          });
        }
        break;
      }

      case "anchor": {
        nodes.push({
          id,
          type: "anchor",
          label: step.name ?? id,
        });
        break;
      }

      default:
        break;
    }

    prevId = id;
  }

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph section serialiser (inlined — avoids coupling to withExportGraph)
// ─────────────────────────────────────────────────────────────────────────────

function serializeGraphStore(store: {
  nodes: Map<string, any>;
  edges: any[];
}): GraphSection {
  const nodes: GraphNodeExport[] = [];

  for (const node of store.nodes.values()) {
    const opts = node.options;
    const r = serOpt(opts?.retries);
    const d = serOpt(opts?.delaySec);
    const t = serOpt(opts?.timeoutMs);
    const hasOpts = r !== undefined || d !== undefined || t !== undefined;
    nodes.push({
      name: node.name,
      ...(hasOpts
        ? {
            options: {
              ...(r !== undefined ? { retries: r } : {}),
              ...(d !== undefined ? { delaySec: d } : {}),
              ...(t !== undefined ? { timeoutMs: t } : {}),
            },
          }
        : {}),
    });
  }

  const edges: GraphEdgeExport[] = store.edges.map((e: any) => ({
    from: e.from,
    to: e.to,
    conditional: !!e.condition,
  }));

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export const withExportFlow: FlowneerPlugin = {
  exportGraph(this: FlowBuilder<any, any>, format: ExportFormat = "json"): any {
    if (format !== "json") {
      if (format === "mermaid") {
        throw new Error(
          'exportGraph: "mermaid" format is not yet implemented. Use "json" for now.',
        );
      }
      throw new Error(`exportGraph: unknown format "${format}"`);
    }

    // Walk the sequential step list
    const steps: any[] = (this as any).steps ?? [];
    const flow = walkSteps(steps);

    // Merge graph store section if present
    const graphStore: { nodes: Map<string, any>; edges: any[] } | undefined = (
      this as any
    ).__graphStore;
    const graph =
      graphStore && graphStore.nodes.size > 0
        ? serializeGraphStore(graphStore)
        : undefined;

    const result: FlowExport = { format: "json", flow };
    if (graph) result.graph = graph;
    return result;
  },
};
