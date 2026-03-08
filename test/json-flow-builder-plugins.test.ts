import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import {
  withAuditFlow,
  withRuntimeCompliance,
  ComplianceError,
} from "../plugins/compliance";
import type { TaintRule } from "../plugins/compliance";
import { withFlowAnalyzer } from "../plugins/dev/withFlowAnalyzer";
import { withDryRun } from "../plugins/dev/withDryRun";
import { JsonFlowBuilder } from "../presets/config";

FlowBuilder.use(withAuditFlow);
FlowBuilder.use(withRuntimeCompliance);
FlowBuilder.use(withFlowAnalyzer);
FlowBuilder.use(withDryRun);

// ─────────────────────────────────────────────────────────────────────────────
// Step type execution
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build — loop step", () => {
  test("loop runs body until condition is false", async () => {
    const shared: any = { count: 0 };
    const registry = {
      notDone: (s: any) => s.count < 3,
      increment: async (s: any) => {
        s.count++;
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "loop",
            condition: "notDone",
            body: [{ type: "fn", fn: "increment" }],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.count).toBe(3);
  });

  test("loop never executes body when condition is initially false", async () => {
    const shared: any = { count: 0 };
    const registry = {
      alreadyDone: () => false,
      increment: async (s: any) => {
        s.count++;
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "loop",
            condition: "alreadyDone",
            body: [{ type: "fn", fn: "increment" }],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.count).toBe(0);
  });

  test("loop body can contain multiple fn steps", async () => {
    const shared: any = { a: 0, b: 0, iter: 0 };
    const registry = {
      cond: (s: any) => s.iter < 2,
      incA: async (s: any) => {
        s.a++;
      },
      incB: async (s: any) => {
        s.b++;
      },
      tick: async (s: any) => {
        s.iter++;
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "loop",
            condition: "cond",
            body: [
              { type: "fn", fn: "incA" },
              { type: "fn", fn: "incB" },
              { type: "fn", fn: "tick" },
            ],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.a).toBe(2);
    expect(shared.b).toBe(2);
  });
});

describe("JsonFlowBuilder.build — batch step", () => {
  test("batch processes each item in the list", async () => {
    const shared: any = { items: [1, 2, 3], results: [] };
    const registry = {
      getItems: (s: any) => s.items,
      process: async (s: any) => {
        s.results.push(s.__item * 2);
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "batch",
            items: "getItems",
            key: "__item",
            processor: [{ type: "fn", fn: "process" }],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.results.sort((a: number, b: number) => a - b)).toEqual([
      2, 4, 6,
    ]);
  });

  test("batch with empty list does not execute processor", async () => {
    const shared: any = { items: [], ran: false };
    const registry = {
      getItems: (s: any) => s.items,
      process: async (s: any) => {
        s.ran = true;
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "batch",
            items: "getItems",
            processor: [{ type: "fn", fn: "process" }],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.ran).toBe(false);
  });

  test("batch uses default __batchItem key when key is omitted", async () => {
    const shared: any = { items: ["a", "b"], seen: [] };
    const registry = {
      getItems: (s: any) => s.items,
      collect: async (s: any) => {
        s.seen.push(s.__batchItem);
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "batch",
            items: "getItems",
            processor: [{ type: "fn", fn: "collect" }],
          },
        ],
      },
      registry,
    );
    await flow.run(shared);
    expect(shared.seen.sort()).toEqual(["a", "b"]);
  });
});

describe("JsonFlowBuilder.build — parallel step", () => {
  test("parallel runs all fns and writes results to shared", async () => {
    const shared: any = {};
    const registry = {
      setX: async (s: any) => {
        s.x = 1;
      },
      setY: async (s: any) => {
        s.y = 2;
      },
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "parallel", fns: ["setX", "setY"] }] },
      registry,
    );
    await flow.run(shared);
    expect(shared.x).toBe(1);
    expect(shared.y).toBe(2);
  });

  test("parallel step followed by fn step executes in order", async () => {
    const order: string[] = [];
    const registry = {
      pA: async () => {
        order.push("pA");
      },
      pB: async () => {
        order.push("pB");
      },
      after: async () => {
        order.push("after");
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "parallel", fns: ["pA", "pB"] },
          { type: "fn", fn: "after" },
        ],
      },
      registry,
    );
    await flow.run({});
    expect(order.slice(-1)).toEqual(["after"]);
    expect(order).toContain("pA");
    expect(order).toContain("pB");
  });
});

describe("JsonFlowBuilder.build — fn step options", () => {
  test("fn step with retries retries on failure", async () => {
    let calls = 0;
    const registry = {
      flakyStep: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
      },
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "flakyStep", retries: 3 }] },
      registry,
    );
    await flow.run({});
    expect(calls).toBe(3);
  });

  test("fn step with label propagates label to step metadata", async () => {
    const labels: string[] = [];
    const registry = {
      myFn: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "myFn", label: "my:label" }] },
      registry,
    );
    flow.addHooks({
      beforeStep: (meta) => {
        if (meta.label) labels.push(meta.label);
      },
    });
    await flow.run({});
    expect(labels).toContain("my:label");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withAuditFlow on JsonFlowBuilder-built flows
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build + withAuditFlow", () => {
  test("detects labelled source and sink in sequential fn steps", () => {
    const registry = {
      fetchUser: async () => {},
      sendEmail: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "fetchUser", label: "pii:fetchUser" },
          { type: "fn", fn: "sendEmail", label: "external:send" },
        ],
      },
      registry,
    );

    const report = (flow as any).auditFlow([
      {
        source: ["pii:fetchUser"],
        sink: ["external:send"],
        message: "PII must not reach external endpoints",
      } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].source.label).toBe("pii:fetchUser");
    expect(report.violations[0].sink.label).toBe("external:send");
  });

  test("passes when there is no taint violation", () => {
    const registry = {
      safeStep: async () => {},
      sendEmail: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "safeStep", label: "safe:step" },
          { type: "fn", fn: "sendEmail", label: "external:send" },
        ],
      },
      registry,
    );

    const report = (flow as any).auditFlow([
      { source: ["pii:*"], sink: ["external:*"] } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  test("detects labelled source inside loop body", () => {
    const registry = {
      cond: () => false,
      fetchInLoop: async () => {},
      sendData: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "loop",
            condition: "cond",
            body: [{ type: "fn", fn: "fetchInLoop", label: "pii:loop" }],
          },
          { type: "fn", fn: "sendData", label: "external:api" },
        ],
      },
      registry,
    );

    const report = (flow as any).auditFlow([
      { source: ["pii:loop"], sink: ["external:api"] } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(false);
  });

  test("wildcard source matches labelled config steps", () => {
    const registry = {
      loadPii: async () => {},
      logOut: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "loadPii", label: "pii:user" },
          { type: "fn", fn: "logOut", label: "thirdParty:log" },
        ],
      },
      registry,
    );

    const report = (flow as any).auditFlow([
      { source: ["pii:*"], sink: ["thirdParty:*"] } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withRuntimeCompliance on JsonFlowBuilder-built flows
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build + withRuntimeCompliance", () => {
  test("throws ComplianceError when labelled step violates rule", async () => {
    const registry = {
      loadData: async (s: any) => {
        s.email = "user@example.com";
      },
      sendOut: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "loadData" },
          { type: "fn", fn: "sendOut", label: "external:send" },
        ],
      },
      registry,
    );

    (flow as any).withRuntimeCompliance([
      {
        filter: ["external:send"],
        check: (s: any) => (s.email ? "PII in shared state" : null),
        onViolation: "throw",
      },
    ]);

    await expect(flow.run({})).rejects.toBeInstanceOf(ComplianceError);
  });

  test("records violation without throwing when onViolation is record", async () => {
    const shared: any = {};
    const registry = {
      setSecret: async (s: any) => {
        s.secret = "hidden";
      },
      logStep: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "setSecret" },
          { type: "fn", fn: "logStep", label: "log:out" },
        ],
      },
      registry,
    );

    (flow as any).withRuntimeCompliance([
      {
        filter: ["log:out"],
        check: (s: any) => (s.secret ? "secret data detected" : null),
        onViolation: "record",
      },
    ]);

    await flow.run(shared);
    expect(shared.__complianceViolations).toHaveLength(1);
    expect(shared.__complianceViolations[0].message).toBe(
      "secret data detected",
    );
  });

  test("inspector without filter fires for every step in built flow", async () => {
    let count = 0;
    const registry = {
      stepA: async () => {},
      stepB: async () => {},
      stepC: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "stepA" },
          { type: "fn", fn: "stepB" },
          { type: "fn", fn: "stepC" },
        ],
      },
      registry,
    );

    (flow as any).withRuntimeCompliance([
      {
        check: () => {
          count++;
          return null;
        },
      },
    ]);

    await flow.run({});
    expect(count).toBe(3);
  });

  test("compliance check does not fire for non-matching label", async () => {
    let fired = false;
    const registry = {
      plainStep: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "plainStep", label: "safe:step" }] },
      registry,
    );

    (flow as any).withRuntimeCompliance([
      {
        filter: ["external:*"],
        check: () => {
          fired = true;
          return null;
        },
        onViolation: "throw",
      },
    ]);

    await flow.run({});
    expect(fired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withTrace on JsonFlowBuilder-built flows
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build + withTrace", () => {
  test("records labelled fn steps in pathSummary", async () => {
    const registry = {
      stepA: async () => {},
      stepB: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "stepA", label: "step:a" },
          { type: "fn", fn: "stepB", label: "step:b" },
        ],
      },
      registry,
    );

    const trace = (flow as any).withTrace();
    await flow.run({});
    expect(trace.getTrace().pathSummary).toEqual(["step:a", "step:b"]);
    trace.dispose();
  });

  test("unlabelled config steps are omitted from pathSummary", async () => {
    const registry = {
      noLabel: async () => {},
      withLabel: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "noLabel" },
          { type: "fn", fn: "withLabel", label: "named:step" },
        ],
      },
      registry,
    );

    const trace = (flow as any).withTrace();
    await flow.run({});
    expect(trace.getTrace().pathSummary).toEqual(["named:step"]);
    trace.dispose();
  });

  test("totalDurationMs is non-negative and equals sum of event durations", async () => {
    const registry = {
      work: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "work" },
          { type: "fn", fn: "work" },
        ],
      },
      registry,
    );

    const trace = (flow as any).withTrace();
    await flow.run({});
    const report = trace.getTrace();
    const sum = report.events.reduce(
      (acc: number, e: any) => acc + e.durationMs,
      0,
    );
    expect(report.totalDurationMs).toBe(sum);
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    trace.dispose();
  });

  test("dispose removes hooks — no events collected after dispose", async () => {
    const registry = { fn: async () => {} };
    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "fn" }] },
      registry,
    );

    const trace = (flow as any).withTrace();
    trace.dispose();
    await flow.run({});
    expect(trace.getTrace().events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withDryRun on JsonFlowBuilder-built flows
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build + withDryRun", () => {
  test("suppresses side effects in built flow", async () => {
    let sideEffect = false;
    const registry = {
      riskyFn: async () => {
        sideEffect = true;
      },
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "riskyFn" }] },
      registry,
    );

    (flow as any).withDryRun();
    await flow.run({});
    expect(sideEffect).toBe(false);
  });

  test("withDryRun + withTrace — traces structure without executing logic", async () => {
    let executed = false;
    const registry = {
      expensive: async () => {
        executed = true;
      },
    };

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "fn", fn: "expensive", label: "expensive:op" }] },
      registry,
    );

    (flow as any).withDryRun();
    const trace = (flow as any).withTrace();
    await flow.run({});

    expect(executed).toBe(false);
    expect(trace.getTrace().pathSummary).toEqual(["expensive:op"]);
    trace.dispose();
  });

  test("withDryRun suppresses all steps in a multi-step config", async () => {
    const calls: string[] = [];
    const registry = {
      a: async () => {
        calls.push("a");
      },
      b: async () => {
        calls.push("b");
      },
      c: async () => {
        calls.push("c");
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "a" },
          { type: "fn", fn: "b" },
          { type: "fn", fn: "c" },
        ],
      },
      registry,
    );

    (flow as any).withDryRun();
    await flow.run({});
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// analyzeFlow on JsonFlowBuilder-built flows
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build + analyzeFlow", () => {
  test("returns fn nodes with correct labels", () => {
    const registry = {
      a: async () => {},
      b: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "a", label: "step:a" },
          { type: "fn", fn: "b", label: "step:b" },
        ],
      },
      registry,
    );

    const map = (flow as any).analyzeFlow();
    expect(map.nodes).toHaveLength(2);
    expect(map.nodes[0].label).toBe("step:a");
    expect(map.nodes[1].label).toBe("step:b");
  });

  test("loop step is represented as a loop node with body", () => {
    const registry = {
      cond: () => false,
      inner: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "loop",
            condition: "cond",
            body: [{ type: "fn", fn: "inner", label: "inner:step" }],
          },
        ],
      },
      registry,
    );

    const map = (flow as any).analyzeFlow();
    const loopNode = map.nodes.find((n: any) => n.type === "loop");
    expect(loopNode).toBeDefined();
    expect(loopNode.body).toHaveLength(1);
    expect(loopNode.body[0].label).toBe("inner:step");
  });

  test("batch step is represented as a batch node with body", () => {
    const registry = {
      getItems: () => [],
      processItem: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "batch",
            items: "getItems",
            processor: [
              { type: "fn", fn: "processItem", label: "process:item" },
            ],
          },
        ],
      },
      registry,
    );

    const map = (flow as any).analyzeFlow();
    const batchNode = map.nodes.find((n: any) => n.type === "batch");
    expect(batchNode).toBeDefined();
    expect(batchNode.body).toHaveLength(1);
    expect(batchNode.body[0].label).toBe("process:item");
  });

  test("branch step has correct branch keys", () => {
    const registry = {
      router: async (s: any) => s.path,
      fastFn: async () => {},
      slowFn: async () => {},
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          {
            type: "branch",
            router: "router",
            branches: { fast: "fastFn", slow: "slowFn" },
          },
        ],
      },
      registry,
    );

    const map = (flow as any).analyzeFlow();
    const branchNode = map.nodes.find((n: any) => n.type === "branch");
    expect(branchNode).toBeDefined();
    expect(branchNode.branches).toHaveProperty("fast");
    expect(branchNode.branches).toHaveProperty("slow");
  });

  test("anchor step appears in anchors list", () => {
    const registry = {
      work: async () => {},
      check: async (s: any) => (s.done ? undefined : "#retry"),
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "anchor", name: "retry", maxVisits: 5 },
          { type: "fn", fn: "work" },
          { type: "fn", fn: "check" },
        ],
      },
      registry,
    );

    const map = (flow as any).analyzeFlow();
    expect(map.anchors).toContain("retry");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JsonFlowBuilder.validate — custom step types
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.validate — custom step types", () => {
  test("custom step type passes validation after registerStepBuilder", () => {
    JsonFlowBuilder.registerStepBuilder("myCustomStep", (_step, flow) => {
      flow.then(async () => {});
    });

    const result = JsonFlowBuilder.validate(
      { steps: [{ type: "myCustomStep" } as any] },
      {},
    );
    expect(result.valid).toBe(true);
  });

  test("unregistered custom type still fails validation", () => {
    const result = JsonFlowBuilder.validate(
      { steps: [{ type: "totallyUnknown" } as any] },
      {},
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("unknown step type")),
    ).toBe(true);
  });

  test("custom step type is executed during build and run", async () => {
    const shared: any = {};
    JsonFlowBuilder.registerStepBuilder("flagStep", (_step, flow) => {
      flow.then(async (s: any) => {
        s.flagged = true;
      });
    });

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "flagStep" } as any] },
      {},
    );
    await flow.run(shared);
    expect(shared.flagged).toBe(true);
  });
});
