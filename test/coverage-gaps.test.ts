// ---------------------------------------------------------------------------
// Coverage-gap tests — exercises paths not covered by existing test suites
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";

// ── Plugins we need to exercise ─────────────────────────────────────────────
import { withVerbose } from "../plugins/observability/withVerbose";
import { withStream, emit } from "../plugins/messaging/withStream";
import { withCallbacks } from "../plugins/observability/withCallbacks";
import { withExportGraph } from "../plugins/graph/withExportGraph";
import { withGraph } from "../plugins/graph";
import {
  TelemetryDaemon,
  consoleExporter,
  otlpExporter,
} from "../plugins/telemetry/telemetry";
import { executeTools, withTools } from "../plugins/tools/withTools";
import { resumeFlow, withHumanNode } from "../plugins/agent/withHumanNode";
import { withReActLoop } from "../plugins/agent/withReActLoop";

// Register all needed plugins for this file
FlowBuilder.use(withVerbose);
FlowBuilder.use(withStream);
FlowBuilder.use(withCallbacks);
FlowBuilder.use(withGraph);
FlowBuilder.use(withHumanNode);
FlowBuilder.use(withReActLoop);
FlowBuilder.use(withTools);

// ─────────────────────────────────────────────────────────────────────────────
// withVerbose
// ─────────────────────────────────────────────────────────────────────────────

describe("withVerbose", () => {
  test("logs shared state to console after each step", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const s: any = { x: 1 };
      await (new FlowBuilder<any>() as any)
        .withVerbose()
        .startWith((s: any) => {
          s.x = 2;
        })
        .then((s: any) => {
          s.x = 3;
        })
        .run(s);
    } finally {
      console.log = origLog;
    }

    expect(logs.length).toBe(2); // one log per step
    expect(logs[0]).toContain("[flowneer]");
    expect(logs[0]).toContain("(fn)"); // step type info
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withStream plugin method (registers beforeFlow hook, stores subscriber)
// ─────────────────────────────────────────────────────────────────────────────

describe("withStream plugin method", () => {
  test("subscriber registered via .withStream() receives emit() chunks", async () => {
    const received: unknown[] = [];
    const s: any = {};

    await (new FlowBuilder<any>() as any)
      .withStream((chunk: unknown) => received.push(chunk))
      .startWith((s: any) => {
        emit(s, "chunk-a");
        emit(s, "chunk-b");
      })
      .run(s);

    expect(received).toEqual(["chunk-a", "chunk-b"]);
  });

  test("emit is a no-op when no subscriber is present", () => {
    const s: any = {};
    expect(() => emit(s, "silent")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withCallbacks — tool: and agent: label prefixes (uncovered branches)
// ─────────────────────────────────────────────────────────────────────────────

// Reuse or re-register the label helper plugin (idempotent)
const labelPlugin = {
  withLabel(this: any, label: string) {
    this._setHooks({
      beforeStep: (meta: any) => {
        meta.label = label;
      },
    });
    return this;
  },
};
FlowBuilder.use(labelPlugin);

describe("withCallbacks — tool/agent label prefixes", () => {
  test("onToolStart / onToolEnd fire for 'tool:*' labeled steps", async () => {
    const events: string[] = [];

    await (new FlowBuilder<any>() as any)
      .withLabel("tool:search")
      .withCallbacks({
        onToolStart: () => events.push("toolStart"),
        onToolEnd: () => events.push("toolEnd"),
        onChainStart: () => events.push("chainStart"), // must NOT fire
      })
      .startWith(async () => {})
      .run({});

    expect(events).toContain("toolStart");
    expect(events).toContain("toolEnd");
    expect(events).not.toContain("chainStart");
  });

  test("onAgentAction / onAgentFinish fire for 'agent:*' labeled steps", async () => {
    const events: string[] = [];

    await (new FlowBuilder<any>() as any)
      .withLabel("agent:orchestrator")
      .withCallbacks({
        onAgentAction: () => events.push("agentAction"),
        onAgentFinish: () => events.push("agentFinish"),
        onChainStart: () => events.push("chainStart"), // must NOT fire
      })
      .startWith(async () => {})
      .run({});

    expect(events).toContain("agentAction");
    expect(events).toContain("agentFinish");
    expect(events).not.toContain("chainStart");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withExportGraph — standalone (direct function call bypasses withExportFlow)
// These tests ensure withExportGraph.ts code paths are exercised even though
// withExportFlow overrides .exportGraph() on the prototype in other test files.
// ─────────────────────────────────────────────────────────────────────────────

describe("withExportGraph — standalone (direct call)", () => {
  const call = (builder: any, format?: any) =>
    (withExportGraph as any).exportGraph.call(builder, format);

  test("returns format: json with nodes and edges", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {});
    (b as any).addNode("B", () => {});
    (b as any).addEdge("A", "B");

    const result = call(b);
    expect(result.format).toBe("json");
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe("A");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe("A");
    expect(result.edges[0].to).toBe("B");
    expect(result.edges[0].conditional).toBe(false);
  });

  test("conditional edges are flagged correctly", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("X", () => {});
    (b as any).addNode("Y", () => {});
    (b as any).addEdge("X", "Y", () => true);

    const result = call(b);
    expect(result.edges[0].conditional).toBe(true);
  });

  test("numeric node options are serialised", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {}, { retries: 3, timeoutMs: 5000 });

    const result = call(b);
    expect(result.nodes[0].options?.retries).toBe(3);
    expect(result.nodes[0].options?.timeoutMs).toBe(5000);
  });

  test("zero-value numeric options are omitted", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {}, { retries: 0, delaySec: 0 });

    const result = call(b);
    expect(result.nodes[0].options).toBeUndefined();
  });

  test("function options are serialised as '<dynamic>'", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {}, { retries: () => 3 });

    const result = call(b);
    expect(result.nodes[0].options?.retries).toBe("<dynamic>");
  });

  test("throws when no graph nodes are registered", () => {
    const b = new FlowBuilder<any>();
    expect(() => call(b)).toThrow("no graph nodes found");
  });

  test("throws for 'mermaid' format", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {});
    expect(() => call(b, "mermaid")).toThrow("mermaid");
  });

  test("throws for an unknown format", () => {
    const b = new FlowBuilder<any>();
    (b as any).addNode("A", () => {});
    expect(() => call(b, "csv")).toThrow("unknown format");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TelemetryDaemon — flush, stop, consoleExporter, otlpExporter
// ─────────────────────────────────────────────────────────────────────────────

describe("TelemetryDaemon", () => {
  const makeSpan = (id: string) => ({
    traceId: id,
    spanId: id,
    name: `span-${id}`,
    startMs: 0,
    endMs: 10,
    durationMs: 10,
    status: "ok" as const,
    attrs: {},
  });

  test("flush() exports buffered spans", async () => {
    const exported: any[] = [];
    const exporter = { export: (s: any[]) => exported.push(...s) };
    const daemon = new TelemetryDaemon({ exporter, flushIntervalMs: 60_000 });

    daemon.record(makeSpan("a"));
    daemon.record(makeSpan("b"));
    await daemon.flush();

    expect(exported).toHaveLength(2);
    expect(exported[0].name).toBe("span-a");
    await daemon.stop();
  });

  test("flush() is a no-op when buffer is empty", async () => {
    const exported: any[] = [];
    const exporter = { export: (s: any[]) => exported.push(...s) };
    const daemon = new TelemetryDaemon({ exporter, flushIntervalMs: 60_000 });

    await daemon.flush(); // empty buffer — nothing exported
    expect(exported).toHaveLength(0);
    await daemon.stop();
  });

  test("stop() clears the timer and flushes remaining spans", async () => {
    const exported: any[] = [];
    const exporter = { export: (s: any[]) => exported.push(...s) };
    const daemon = new TelemetryDaemon({ exporter, flushIntervalMs: 60_000 });

    daemon.record(makeSpan("x"));
    await daemon.stop();

    expect(exported).toHaveLength(1);
    expect(exported[0].name).toBe("span-x");

    // Calling stop() again (timer already null) must not throw
    await daemon.stop();
  });

  test("maxBuffer triggers an early flush before stop()", async () => {
    const batches: any[][] = [];
    const exporter = { export: (s: any[]) => batches.push([...s]) };
    const daemon = new TelemetryDaemon({
      exporter,
      maxBuffer: 2,
      flushIntervalMs: 60_000,
    });

    daemon.record(makeSpan("p"));
    daemon.record(makeSpan("q")); // hits maxBuffer=2 → flush fires synchronously

    // Give the async flush a tick to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(batches.length).toBeGreaterThan(0);
    await daemon.stop();
  });

  test("consoleExporter logs ok and error spans with parent info", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: any[]) => lines.push(a.join(" "));

    try {
      consoleExporter.export([
        {
          traceId: "abcdef1234567890",
          spanId: "deadbeef",
          name: "fn[0]",
          startMs: 0,
          endMs: 10,
          durationMs: 10,
          status: "ok",
          attrs: {},
        },
        {
          traceId: "aabbccdd11223344",
          spanId: "cafebabe",
          parentId: "deadbeef",
          name: "fn[1]",
          startMs: 5,
          endMs: 20,
          durationMs: 15,
          status: "error",
          attrs: {},
        },
      ]);
    } finally {
      console.log = orig;
    }

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("fn[0]");
    expect(lines[1]).toContain("fn[1]");
    expect(lines[1]).toContain("parent="); // parentId present → rendered
  });

  test("otlpExporter sends spans via fetch", async () => {
    const calls: any[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, opts: any) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true } as Response;
    };

    try {
      const exp = otlpExporter("http://localhost:4318/v1/traces");
      await exp.export([makeSpan("z")]);
    } finally {
      (globalThis as any).fetch = origFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:4318/v1/traces");
    expect(calls[0].body.spans).toHaveLength(1);
    expect(calls[0].body.spans[0].name).toBe("span-z");
  });

  test("otlpExporter swallows network errors silently", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      throw new Error("network failure");
    };

    try {
      const exp = otlpExporter("http://localhost:4318/v1/traces");
      await expect(exp.export([makeSpan("err")])).resolves.toBeUndefined();
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeTools — no-registry path
// ─────────────────────────────────────────────────────────────────────────────

describe("executeTools helper — no registry", () => {
  test("returns error results for each call when __tools is absent", async () => {
    const shared: any = {}; // no __tools
    const calls = [
      { id: "c1", name: "add", args: { a: 1, b: 2 } },
      { id: "c2", name: "mul", args: { a: 3, b: 4 } },
    ];

    const results = await executeTools(shared, calls);

    expect(results).toHaveLength(2);
    expect(results[0].error).toContain("no tool registry");
    expect(results[0].callId).toBe("c1");
    expect(results[1].error).toContain("no tool registry");
    expect(results[1].callId).toBe("c2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resumeFlow — fromStep > 0 branch (dynamic withReplay import)
// ─────────────────────────────────────────────────────────────────────────────

describe("resumeFlow — fromStep > 0", () => {
  test("skips steps before fromStep when fromStep is provided", async () => {
    const log: string[] = [];

    const flow = (new FlowBuilder<any>() as any)
      .startWith(() => {
        log.push("step0");
      })
      .then(() => {
        log.push("step1");
      })
      .then(() => {
        log.push("step2");
      });

    // Resume from step 1 — step0 (index 0) should be skipped
    await resumeFlow(flow, {}, {}, 1);

    expect(log).not.toContain("step0");
    expect(log).toContain("step1");
    expect(log).toContain("step2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withReActLoop — no tool registry error path
// ─────────────────────────────────────────────────────────────────────────────

describe("withReActLoop — no tool registry", () => {
  test("throws when tools are requested but no registry is attached", async () => {
    const s: any = {};

    await expect(
      (new FlowBuilder<any>() as any)
        // Intentionally no .withTools() — __tools absent
        .withReActLoop({
          think: () => ({
            action: "tool" as const,
            calls: [{ name: "add", args: {} }],
          }),
          maxIterations: 1,
        })
        .run(s),
    ).rejects.toThrow("withReActLoop requires .withTools()");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withGraph — conditional forward edges (skip-ahead, not back-edges)
// Covers graph/index.ts lines 154,233-234,267-270,272,274-275
// ─────────────────────────────────────────────────────────────────────────────

describe("withGraph — conditional forward edge (skip-ahead)", () => {
  test("conditional forward edge skips a node when condition is true", async () => {
    const log: string[] = [];

    await (new FlowBuilder<{ skip: boolean }>() as any)
      .addNode("A", (s: any) => {
        log.push("A");
      })
      .addNode("B", (s: any) => {
        log.push("B");
      })
      .addNode("C", (s: any) => {
        log.push("C");
      })
      .addEdge("A", "B")
      .addEdge("B", "C")
      // Conditional FORWARD edge: A→C (toPos[C]=2 > toPos[A]=0) — skip B
      .addEdge("A", "C", (s: any) => s.skip)
      .compile()
      .run({ skip: true });

    expect(log).toContain("A");
    expect(log).not.toContain("B"); // B skipped
    expect(log).toContain("C");
  });

  test("conditional forward edge does not skip when condition is false", async () => {
    const log: string[] = [];

    await (new FlowBuilder<{ skip: boolean }>() as any)
      .addNode("A", (s: any) => {
        log.push("A");
      })
      .addNode("B", (s: any) => {
        log.push("B");
      })
      .addNode("C", (s: any) => {
        log.push("C");
      })
      .addEdge("A", "B")
      .addEdge("B", "C")
      .addEdge("A", "C", (s: any) => s.skip)
      .compile()
      .run({ skip: false });

    expect(log).toEqual(["A", "B", "C"]);
  });

  test("conditional forward edge from middle node skips to end", async () => {
    const log: string[] = [];

    await (new FlowBuilder<{ skipToEnd: boolean }>() as any)
      .addNode("start", (s: any) => {
        log.push("start");
      })
      .addNode("middle", (s: any) => {
        log.push("middle");
      })
      .addNode("end", (s: any) => {
        log.push("end");
      })
      .addEdge("start", "middle")
      .addEdge("middle", "end")
      // Forward conditional from start to end (skip middle)
      .addEdge("start", "end", (s: any) => s.skipToEnd)
      .compile()
      .run({ skipToEnd: true });

    expect(log).toContain("start");
    expect(log).not.toContain("middle");
    expect(log).toContain("end");
  });
});
