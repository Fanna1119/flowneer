// ---------------------------------------------------------------------------
// Tests for plugins/graph/withExportFlow
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder, fragment } from "../Flowneer";
import { withGraph } from "../plugins/graph";
import { withExportFlow } from "../plugins/graph/withExportFlow";
import type { FlowExport } from "../plugins/graph/withExportFlow";

FlowBuilder.use(withGraph);
FlowBuilder.use(withExportFlow); // overrides exportGraph from withExportGraph

const noop = () => {};
function named() {}

// ─────────────────────────────────────────────────────────────────────────────
// Basic shape
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — basic shape", () => {
  test("returns format: 'json'", () => {
    const result = new FlowBuilder().exportGraph();
    expect(result.format).toBe("json");
  });

  test("always has a flow section", () => {
    const result = new FlowBuilder().exportGraph();
    expect(result).toHaveProperty("flow");
    expect(Array.isArray(result.flow.nodes)).toBe(true);
    expect(Array.isArray(result.flow.edges)).toBe(true);
  });

  test("empty builder has empty flow section and no graph section", () => {
    const result = new FlowBuilder().exportGraph();
    expect(result.flow.nodes).toHaveLength(0);
    expect(result.flow.edges).toHaveLength(0);
    expect(result.graph).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fn steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — fn steps", () => {
  test("each .then() produces a fn node", () => {
    const result = new FlowBuilder().then(noop).then(noop).exportGraph();
    const fnNodes = result.flow.nodes.filter((n) => n.type === "fn");
    expect(fnNodes).toHaveLength(2);
  });

  test("named function label is used", () => {
    const result = new FlowBuilder().then(named).exportGraph();
    expect(result.flow.nodes[0]!.label).toBe("named");
  });

  test("anonymous arrow function label is 'anonymous'", () => {
    const result = new FlowBuilder().then(() => {}).exportGraph();
    expect(result.flow.nodes[0]!.label).toBe("anonymous");
  });

  test("sequential edges connect fn steps", () => {
    const result = new FlowBuilder()
      .then(noop)
      .then(noop)
      .then(noop)
      .exportGraph();
    expect(result.flow.edges).toHaveLength(2);
    expect(result.flow.edges[0]!.kind).toBe("sequential");
    expect(result.flow.edges[1]!.kind).toBe("sequential");
    // chain: fn_0 → fn_1 → fn_2
    expect(result.flow.edges[0]!.from).toBe("fn_0");
    expect(result.flow.edges[0]!.to).toBe("fn_1");
  });

  test("node retries option is serialised", () => {
    const result = new FlowBuilder().then(noop, { retries: 3 }).exportGraph();
    expect(result.flow.nodes[0]!.options?.retries).toBe(3);
  });

  test("zero-value options are omitted", () => {
    const result = new FlowBuilder()
      .then(noop, { retries: 1, delaySec: 0, timeoutMs: 0 })
      .exportGraph();
    // retries 1 is the default encoded as 1 (non-zero, still shown)
    expect(result.flow.nodes[0]!.options?.delaySec).toBeUndefined();
    expect(result.flow.nodes[0]!.options?.timeoutMs).toBeUndefined();
  });

  test("function options are serialised as '<dynamic>'", () => {
    const result = new FlowBuilder()
      .then(noop, { retries: (s: any) => s.r ?? 1 })
      .exportGraph();
    expect(result.flow.nodes[0]!.options?.retries).toBe("<dynamic>");
  });

  test("non-serialisable option types (e.g. boolean) are omitted", () => {
    // Passes a boolean — not undefined/null/number/function — so serOpt falls
    // through to its final `return undefined`, keeping the node options absent.
    const result = new FlowBuilder()
      .then(noop, { retries: true as any })
      .exportGraph();
    expect(result.flow.nodes[0]!.options).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anchor steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — anchor steps", () => {
  test("anchor step produces an anchor node with id 'anchor:name'", () => {
    const result = new FlowBuilder().anchor("recover").exportGraph();
    const anchor = result.flow.nodes.find((n) => n.type === "anchor");
    expect(anchor).toBeDefined();
    expect(anchor!.id).toBe("anchor:recover");
    expect(anchor!.label).toBe("recover");
  });

  test("anchor node is connected via sequential edge", () => {
    const result = new FlowBuilder()
      .then(noop)
      .anchor("a")
      .then(noop)
      .exportGraph();
    const ids = result.flow.nodes.map((n) => n.id);
    expect(ids).toContain("anchor:a");
    const edgeToAnchor = result.flow.edges.find((e) => e.to === "anchor:a");
    expect(edgeToAnchor).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Branch steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — branch steps", () => {
  test("branch step produces a branch node with meta.branches", () => {
    const result = new FlowBuilder()
      .branch((s: any) => s.path, { left: noop, right: noop })
      .exportGraph();

    const branchNode = result.flow.nodes.find((n) => n.type === "branch");
    expect(branchNode).toBeDefined();
    expect(branchNode!.meta?.branches).toEqual(["left", "right"]);
  });

  test("each branch arm gets its own fn node with branch-arm edge", () => {
    const result = new FlowBuilder()
      .branch((s: any) => s.p, { a: named, b: noop })
      .exportGraph();

    const armNodes = result.flow.nodes.filter((n) => n.id.includes(":arm:"));
    expect(armNodes).toHaveLength(2);

    const armEdges = result.flow.edges.filter((e) => e.kind === "branch-arm");
    expect(armEdges).toHaveLength(2);
    expect(armEdges.map((e) => e.label).sort()).toEqual(["a", "b"]);
  });

  test("named branch fn label is used", () => {
    const result = new FlowBuilder()
      .branch((s: any) => s.p, { go: named })
      .exportGraph();
    const armNode = result.flow.nodes.find((n) => n.id.includes(":arm:go"));
    expect(armNode!.label).toBe("named");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loop steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — loop steps", () => {
  test("loop step produces a loop node", () => {
    const result = new FlowBuilder()
      .loop(
        () => false,
        (b) => b.then(noop),
      )
      .exportGraph();

    const loopNode = result.flow.nodes.find((n) => n.type === "loop");
    expect(loopNode).toBeDefined();
  });

  test("loop body steps appear as prefixed nodes", () => {
    const result = new FlowBuilder()
      .loop(
        () => false,
        (b) => b.then(named),
      )
      .exportGraph();

    const bodyNode = result.flow.nodes.find((n) =>
      n.id.startsWith("loop_0:body:"),
    );
    expect(bodyNode).toBeDefined();
    expect(bodyNode!.label).toBe("named");
  });

  test("loop-body edge connects loop to body, loop-back connects back", () => {
    const result = new FlowBuilder()
      .loop(
        () => false,
        (b) => b.then(noop),
      )
      .exportGraph();

    const bodyEdge = result.flow.edges.find((e) => e.kind === "loop-body");
    const backEdge = result.flow.edges.find((e) => e.kind === "loop-back");
    expect(bodyEdge).toBeDefined();
    expect(backEdge).toBeDefined();
    expect(bodyEdge!.from).toBe("loop_0");
    expect(backEdge!.to).toBe("loop_0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — batch steps", () => {
  test("batch step produces a batch node with meta.key", () => {
    const result = new FlowBuilder()
      .batch(
        (s: any) => s.items,
        (b) => b.then(noop),
        { key: "__item" },
      )
      .exportGraph();

    const batchNode = result.flow.nodes.find((n) => n.type === "batch");
    expect(batchNode).toBeDefined();
    expect(batchNode!.meta?.key).toBe("__item");
  });

  test("batch processor steps appear as prefixed sub-nodes", () => {
    const result = new FlowBuilder()
      .batch(
        (s: any) => s.items,
        (b) => b.then(named),
      )
      .exportGraph();

    const procNode = result.flow.nodes.find((n) =>
      n.id.startsWith("batch_0:each:"),
    );
    expect(procNode).toBeDefined();
    expect(procNode!.label).toBe("named");
  });

  test("batch-body edge connects batch node to first processor step", () => {
    const result = new FlowBuilder()
      .batch(
        (s: any) => s.items,
        (b) => b.then(noop),
      )
      .exportGraph();

    const batchEdge = result.flow.edges.find((e) => e.kind === "batch-body");
    expect(batchEdge).toBeDefined();
    expect(batchEdge!.from).toBe("batch_0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parallel steps
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — parallel steps", () => {
  test("parallel step produces a parallel node with meta.count", () => {
    const result = new FlowBuilder()
      .parallel([noop, named, noop])
      .exportGraph();

    const parallelNode = result.flow.nodes.find((n) => n.type === "parallel");
    expect(parallelNode).toBeDefined();
    expect(parallelNode!.meta?.count).toBe(3);
  });

  test("each parallel fn gets a fan-out node", () => {
    const result = new FlowBuilder().parallel([noop, named]).exportGraph();
    const fanNodes = result.flow.nodes.filter((n) =>
      n.id.startsWith("parallel_0:fn_"),
    );
    expect(fanNodes).toHaveLength(2);
  });

  test("named parallel fn label is used", () => {
    const result = new FlowBuilder().parallel([named]).exportGraph();
    const fnNode = result.flow.nodes.find((n) => n.id === "parallel_0:fn_0");
    expect(fnNode!.label).toBe("named");
  });

  test("parallel-fan-out edges connect parallel node to each fn", () => {
    const result = new FlowBuilder().parallel([noop, noop]).exportGraph();
    const fanEdges = result.flow.edges.filter(
      (e) => e.kind === "parallel-fan-out",
    );
    expect(fanEdges).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graph store merging
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — graph store merging", () => {
  test("no graph section when only sequential steps", () => {
    const result = new FlowBuilder().then(noop).exportGraph();
    expect(result.graph).toBeUndefined();
  });

  test("graph section present when addNode/addEdge called", () => {
    const result = new FlowBuilder<any>()
      .addNode("fetch", noop)
      .addNode("save", noop)
      .addEdge("fetch", "save")
      .exportGraph();

    expect(result.graph).toBeDefined();
    expect(result.graph!.nodes.map((n) => n.name)).toEqual(["fetch", "save"]);
    expect(result.graph!.edges).toEqual([
      { from: "fetch", to: "save", conditional: false },
    ]);
  });

  test("graph section has conditional flag set for conditional edges", () => {
    const result = new FlowBuilder<any>()
      .addNode("a", noop)
      .addNode("b", noop)
      .addEdge("a", "b", (s: any) => s.go)
      .exportGraph();

    expect(result.graph!.edges[0]!.conditional).toBe(true);
  });

  test("graph node with options includes them in graph section", () => {
    const result = new FlowBuilder<any>()
      .addNode("a", noop, { retries: 2 })
      .exportGraph();

    expect(result.graph!.nodes[0]!.options?.retries).toBe(2);
  });

  test("flow section is empty when only graph nodes registered (no compiled steps)", () => {
    const result = new FlowBuilder<any>().addNode("a", noop).exportGraph();

    expect(result.flow.nodes).toHaveLength(0);
    expect(result.flow.edges).toHaveLength(0);
  });

  test("both sections populated after addNode and then()", async () => {
    const result = new FlowBuilder<any>()
      .then(noop)
      .addNode("g", noop)
      .exportGraph();

    expect(result.flow.nodes.length).toBeGreaterThan(0);
    expect(result.graph).toBeDefined();
    expect(result.graph!.nodes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-destructive
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — non-destructive", () => {
  test("compile() works after exportGraph()", async () => {
    const s: { ran: boolean } = { ran: false };

    const flow = new FlowBuilder<typeof s>().addNode("a", (x) => {
      x.ran = true;
    });

    flow.exportGraph();
    flow.compile();

    await flow.run(s);
    expect(s.ran).toBe(true);
  });

  test("sequential flow can still run after exportGraph()", async () => {
    const s: { count: number } = { count: 0 };
    const flow = new FlowBuilder<typeof s>()
      .then((x) => {
        x.count++;
      })
      .then((x) => {
        x.count++;
      });

    flow.exportGraph();
    await flow.run(s);
    expect(s.count).toBe(2);
  });

  test("exportGraph() is idempotent", () => {
    const flow = new FlowBuilder().then(noop).then(noop);
    expect(flow.exportGraph()).toEqual(flow.exportGraph());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — errors", () => {
  test('throws for "mermaid" format', () => {
    expect(() => (new FlowBuilder() as any).exportGraph("mermaid")).toThrow(
      "not yet implemented",
    );
  });

  test("throws for unknown format", () => {
    expect(() => (new FlowBuilder() as any).exportGraph("graphviz")).toThrow(
      'unknown format "graphviz"',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportFlow — JSON round-trip", () => {
  test("full output is JSON-serialisable", () => {
    const result: FlowExport = new FlowBuilder<any>()
      .then(named)
      .then(noop, { retries: 3 })
      .anchor("mid")
      .branch((s: any) => s.p, { yes: named, no: noop })
      .loop(
        () => false,
        (b) => b.then(noop),
      )
      .parallel([named, noop])
      .addNode("g", noop, { retries: 2 })
      .addEdge("g", "g", (s: any) => s.loop)
      .exportGraph();

    const parsed: FlowExport = JSON.parse(JSON.stringify(result));
    expect(parsed.format).toBe("json");
    expect(parsed.flow.nodes.length).toBe(result.flow.nodes.length);
    expect(parsed.graph).toBeDefined();
  });
});
