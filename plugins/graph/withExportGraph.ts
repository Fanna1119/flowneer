// ---------------------------------------------------------------------------
// withExportGraph — serialise a graph flow's nodes + edges for debugging
// ---------------------------------------------------------------------------
//
//   flow
//     .addNode("fetch", fetchData)
//     .addNode("transform", transformData)
//     .addNode("save", saveData)
//     .addEdge("fetch", "transform")
//     .addEdge("transform", "save")
//     .addEdge("transform", "fetch", (s) => s.needsRetry)
//     .exportGraph();          // → GraphExport (JSON-serialisable object)
//     .exportGraph("json");    // same
//     .compile();              // can still be called afterwards
//
// The method is intentionally non-destructive — it reads the graph store
// without compiling it, so `.compile()` can still be chained after.
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import type { GraphNode, GraphEdge } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Public output types
// ─────────────────────────────────────────────────────────────────────────────

/** A single node entry in the exported graph. */
export interface GraphNodeExport {
  name: string;
  /** Numeric options that were supplied at `.addNode()` time. */
  options?: {
    retries?: number | string;
    delaySec?: number | string;
    timeoutMs?: number | string;
  };
}

/** A single edge entry in the exported graph. */
export interface GraphEdgeExport {
  from: string;
  to: string;
  /** `true` when the edge has a runtime condition (back-edge / skip-ahead). */
  conditional: boolean;
}

/** The root object returned by `.exportGraph("json")`. */
export interface GraphExport {
  format: "json";
  nodes: GraphNodeExport[];
  edges: GraphEdgeExport[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Format registry — add new cases here as formats are implemented
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported export formats.
 * - `"json"` — JSON-serialisable structure (implemented).
 * - `"mermaid"` — Mermaid flowchart string (reserved for future use).
 */
export type ExportFormat = "json" | "mermaid";

type FormatResult<F extends ExportFormat> = F extends "json"
  ? GraphExport
  : F extends "mermaid"
    ? string
    : never;

// ─────────────────────────────────────────────────────────────────────────────
// Declaration merging
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Export the graph (nodes + edges) in the given format.
     *
     * When only `withExportGraph` is loaded this returns `GraphExport`.
     * Load `withExportFlow` to get the unified `FlowExport` shape instead.
     *
     * Non-JSON formats are reserved for future implementation.
     */
    exportGraph<F extends ExportFormat>(format: F): FormatResult<F>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialisers — one per format
// ─────────────────────────────────────────────────────────────────────────────

function serializeOption(val: unknown): number | string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val === 0 ? undefined : val;
  if (typeof val === "function") return "<dynamic>";
  return undefined;
}

function toJson(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): GraphExport {
  const nodeExports: GraphNodeExport[] = [];
  for (const node of nodes.values()) {
    const opts = node.options;
    const optExport: GraphNodeExport["options"] = opts
      ? {
          retries: serializeOption(opts.retries),
          delaySec: serializeOption(opts.delaySec),
          timeoutMs: serializeOption(opts.timeoutMs),
        }
      : undefined;

    // Drop the options key entirely if all values are undefined
    const hasOpts =
      optExport &&
      (optExport.retries !== undefined ||
        optExport.delaySec !== undefined ||
        optExport.timeoutMs !== undefined);

    nodeExports.push({
      name: node.name,
      ...(hasOpts ? { options: optExport } : {}),
    });
  }

  const edgeExports: GraphEdgeExport[] = edges.map((e) => ({
    from: e.from,
    to: e.to,
    conditional: !!e.condition,
  }));

  return { format: "json", nodes: nodeExports, edges: edgeExports };
}

// ─────────────────────────────────────────────────────────────────────────────
// Format dispatcher — add new `case` blocks here when adding formats
// ─────────────────────────────────────────────────────────────────────────────

function dispatch(
  format: ExportFormat,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): GraphExport | string {
  switch (format) {
    case "json":
      return toJson(nodes, edges);

    case "mermaid":
      // Reserved — implement toMermaid(nodes, edges) here when ready.
      throw new Error(
        'exportGraph: "mermaid" format is not yet implemented. ' +
          'Use "json" for now.',
      );

    default: {
      const _exhaustive: never = format;
      throw new Error(`exportGraph: unknown format "${_exhaustive}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export const withExportGraph: FlowneerPlugin = {
  exportGraph(this: FlowBuilder<any, any>, format: ExportFormat = "json"): any {
    const store:
      | { nodes: Map<string, GraphNode>; edges: GraphEdge[] }
      | undefined = (this as any).__graphStore;

    if (!store || store.nodes.size === 0) {
      throw new Error(
        "exportGraph: no graph nodes found. " +
          "Call .addNode() / .addEdge() before .exportGraph().",
      );
    }

    return dispatch(format, store.nodes, store.edges);
  },
};
