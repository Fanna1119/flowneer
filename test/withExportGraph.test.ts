// ---------------------------------------------------------------------------
// Tests for plugins/graph/withExportGraph
//
// withExportFlow is always compiled alongside withExportGraph in this project,
// so its declaration (FlowExport) takes precedence and its runtime
// implementation is used.  Graph-specific output lives in result.graph.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import { withGraph } from "../plugins/graph";
import { withExportFlow } from "../plugins/graph/withExportFlow";
import type { FlowExport } from "../plugins/graph/withExportFlow";

FlowBuilder.use(withGraph);
FlowBuilder.use(withExportFlow);

const noop = () => {};

// ---------------------------------------------------------------------------
// Basic JSON structure
// ---------------------------------------------------------------------------

describe("withExportGraph — JSON structure", () => {
  test("returns format: 'json'", () => {
    const result = new FlowBuilder<any>().addNode("a", noop).exportGraph();
    expect(result.format).toBe("json");
  });

  test("graph section is populated for graph-only builders", () => {
    const result = new FlowBuilder<any>().addNode("a", noop).exportGraph();
    expect(result.graph).toBeDefined();
  });

  test("nodes list reflects all registered nodes in insertion order", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("fetch", noop)
      .addNode("transform", noop)
      .addNode("save", noop)
      .exportGraph();

    expect(result.graph!.nodes.map((n) => n.name)).toEqual([
      "fetch",
      "transform",
      "save",
    ]);
  });

  test("edges list reflects all registered edges", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop)
      .addNode("b", noop)
      .addNode("c", noop)
      .addEdge("a", "b")
      .addEdge("b", "c")
      .exportGraph();

    expect(result.graph!.edges).toEqual([
      { from: "a", to: "b", conditional: false },
      { from: "b", to: "c", conditional: false },
    ]);
  });

  test("conditional edges are flagged correctly", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop)
      .addNode("b", noop)
      .addEdge("a", "b")
      .addEdge("b", "a", (s: any) => s.retry)
      .exportGraph();

    expect(result.graph!.edges[0]!.conditional).toBe(false);
    expect(result.graph!.edges[1]!.conditional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Node options serialisation
// ---------------------------------------------------------------------------

describe("withExportGraph — node options", () => {
  test("node without options has no options key", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop)
      .exportGraph();

    expect(result.graph!.nodes[0]).toEqual({ name: "a" });
    expect("options" in result.graph!.nodes[0]!).toBe(false);
  });

  test("numeric options are serialised", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop, { retries: 3, timeoutMs: 5000 })
      .exportGraph();

    expect(result.graph!.nodes[0]!.options).toMatchObject({
      retries: 3,
      timeoutMs: 5000,
    });
  });

  test("zero-value numeric options are omitted (they equal the default)", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop, { retries: 0, delaySec: 0 })
      .exportGraph();

    // Both are 0 (defaults), so options should be dropped entirely
    expect("options" in result.graph!.nodes[0]!).toBe(false);
  });

  test("function options are serialised as '<dynamic>'", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("a", noop, {
        retries: (s: any) => s.retries ?? 1,
        timeoutMs: 1000,
      })
      .exportGraph();

    expect(result.graph!.nodes[0]!.options?.retries).toBe("<dynamic>");
    expect(result.graph!.nodes[0]!.options?.timeoutMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Non-destructive — compile can still be called after exportGraph
// ---------------------------------------------------------------------------

describe("withExportGraph — non-destructive", () => {
  test("compile() can be called after exportGraph()", async () => {
    const s: { visited: string[] } = { visited: [] };

    const flow = new FlowBuilder<typeof s>()
      .addNode("a", (x) => {
        x.visited.push("a");
      })
      .addNode("b", (x) => {
        x.visited.push("b");
      })
      .addEdge("a", "b");

    flow.exportGraph(); // must not clear the graph store
    flow.compile();

    await flow.run(s);

    expect(s.visited).toEqual(["a", "b"]);
  });

  test("exportGraph() is idempotent — calling it twice returns equal results", () => {
    const flow = new FlowBuilder()
      .addNode("x", noop)
      .addNode("y", noop)
      .addEdge("x", "y");

    const first = flow.exportGraph();
    const second = flow.exportGraph();

    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("withExportGraph — errors", () => {
  test("empty builder produces no graph section (no throw)", () => {
    // withExportFlow handles empty builders gracefully
    const result = new FlowBuilder().exportGraph();
    expect(result.graph).toBeUndefined();
    expect(result.flow.nodes).toHaveLength(0);
  });

  test('throws for "mermaid" format (not yet implemented)', () => {
    expect(() =>
      (new FlowBuilder<any>().addNode("a", noop) as any).exportGraph("mermaid"),
    ).toThrow("not yet implemented");
  });

  test("throws for an unknown format", () => {
    expect(() =>
      (new FlowBuilder<any>().addNode("a", noop) as any).exportGraph(
        "graphviz",
      ),
    ).toThrow('unknown format "graphviz"');
  });
});

// ---------------------------------------------------------------------------
// Round-trip — JSON.stringify / JSON.parse
// ---------------------------------------------------------------------------

describe("withExportGraph — JSON round-trip", () => {
  test("output is fully JSON-serialisable", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .addNode("start", noop)
      .addNode("end", noop, { retries: 2 })
      .addEdge("start", "end")
      .exportGraph();

    const parsed: FlowExport = JSON.parse(JSON.stringify(result));

    expect(parsed.format).toBe("json");
    expect(parsed.graph!.nodes).toEqual(result.graph!.nodes);
    expect(parsed.graph!.edges).toEqual(result.graph!.edges);
  });
});
