import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";

// Compliance
import {
  withAuditFlow,
  withRuntimeCompliance,
  ComplianceError,
  scanShared,
} from "../plugins/compliance";
import type { TaintRule } from "../plugins/compliance";

// Dev / Path Analyzer
import { withFlowAnalyzer } from "../plugins/dev/withFlowAnalyzer";
import { withDryRun } from "../plugins/dev/withDryRun";

// Config
import { JsonFlowBuilder, ConfigValidationError } from "../presets/config";
import { validate } from "../plugins/config";

const CA = FlowBuilder.extend([withAuditFlow, withRuntimeCompliance, withFlowAnalyzer, withDryRun]);

// ─────────────────────────────────────────────────────────────────────────────
// Compliance — auditFlow (static)
// ─────────────────────────────────────────────────────────────────────────────

describe("withAuditFlow", () => {
  test("detects a sink step after a source step", () => {
    const flow = new CA<any>()
      .then(
        async (s) => {
          s.email = "user@example.com";
        },
        { label: "pii:fetchUser" },
      )
      .then(
        async (s) => {
          /* call external API */
        },
        { label: "external:send" },
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

  test("passes when there is no source before the sink", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "external:send" })
      .then(async () => {}, { label: "pii:fetchUser" });

    const report = (flow as any).auditFlow([
      {
        source: ["pii:fetchUser"],
        sink: ["external:send"],
      } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  test("wildcard source filter matches prefix", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "pii:user" })
      .then(async () => {}, { label: "external:api" });

    const report = (flow as any).auditFlow([
      { source: ["pii:*"], sink: ["external:*"] } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(false);
  });

  test("predicate filter works", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "pii:address" })
      .then(async () => {}, { label: "thirdParty:log" });

    const report = (flow as any).auditFlow([
      {
        source: (meta: any) => meta.label?.startsWith("pii:") ?? false,
        sink: (meta: any) => meta.label?.startsWith("thirdParty:") ?? false,
      } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(false);
  });

  test("no violations when labels don't match any rule", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "step:a" })
      .then(async () => {}, { label: "step:b" });

    const report = (flow as any).auditFlow([
      { source: ["pii:*"], sink: ["external:*"] } satisfies TaintRule,
    ]);

    expect(report.passed).toBe(true);
  });

  test("anchor steps are traversed without causing false violations", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "pii:fetch" })
      .anchor("retry")
      .then(async () => {}, { label: "external:send" });

    const report = (flow as any).auditFlow([
      { source: ["pii:fetch"], sink: ["external:send"] } satisfies TaintRule,
    ]);
    // anchor between source and sink does not block violation detection
    expect(report.passed).toBe(false);
  });

  test("loop body steps are scanned for taint", () => {
    const flow = new CA<any>()
      .loop(
        async (s) => !s.done,
        (b) =>
          b.then(
            async (s) => {
              s.done = true;
            },
            { label: "pii:innerFetch" },
          ),
      )
      .then(async () => {}, { label: "external:send" });

    const report = (flow as any).auditFlow([
      {
        source: ["pii:innerFetch"],
        sink: ["external:send"],
      } satisfies TaintRule,
    ]);
    expect(report.passed).toBe(false);
  });

  test("batch processor steps are scanned for taint", () => {
    const flow = new CA<any>()
      .batch(
        async (s) => s.items,
        (b) => b.then(async () => {}, { label: "pii:item" }),
      )
      .then(async () => {}, { label: "external:send" });

    const report = (flow as any).auditFlow([
      { source: ["pii:item"], sink: ["external:send"] } satisfies TaintRule,
    ]);
    expect(report.passed).toBe(false);
  });

  test("branch arm labels are included in taint scan", () => {
    function piiArm(_s: any) {}
    const flow = new CA<any>()
      .branch(async (s) => s.path, { piiArm, other: async () => {} })
      .then(async () => {}, { label: "external:send" });

    const report = (flow as any).auditFlow([
      {
        source: (meta: any) => meta.label === "piiArm",
        sink: ["external:send"],
      } satisfies TaintRule,
    ]);
    expect(report.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compliance — withRuntimeCompliance
// ─────────────────────────────────────────────────────────────────────────────

describe("withRuntimeCompliance", () => {
  test('onViolation "throw" — throws ComplianceError', async () => {
    const flow = new CA<{ email?: string }>()
      .then(async (s) => {
        s.email = "user@example.com";
      })
      .then(
        async () => {
          /* outbound */
        },
        { label: "external:send" },
      );

    (flow as any).withRuntimeCompliance([
      {
        filter: ["external:send"],
        check: (shared: any) => (shared.email ? "PII in shared" : null),
        onViolation: "throw",
      },
    ]);

    await expect((flow as any).run({})).rejects.toBeInstanceOf(ComplianceError);
  });

  test('onViolation "record" — collects violations without throwing', async () => {
    const shared: any = {};
    const flow = new CA<any>()
      .then(async (s) => {
        s.sensitive = "secret";
      })
      .then(async () => {}, { label: "log:step" });

    (flow as any).withRuntimeCompliance([
      {
        filter: ["log:step"],
        check: (s: any) => (s.sensitive ? "sensitive data found" : null),
        onViolation: "record",
      },
    ]);

    await (flow as any).run(shared);
    expect(shared.__complianceViolations).toHaveLength(1);
    expect(shared.__complianceViolations[0].message).toBe(
      "sensitive data found",
    );
  });

  test("inspector with no filter fires for all steps", async () => {
    let count = 0;
    const flow = new CA<any>()
      .then(async () => {})
      .then(async () => {})
      .then(async () => {});

    (flow as any).withRuntimeCompliance([
      {
        check: () => {
          count++;
          return null;
        },
      },
    ]);

    await (flow as any).run({});
    expect(count).toBe(3);
  });

  test('onViolation "warn" — logs warning and does not throw', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(" "));
    try {
      const flow = new CA<any>()
        .then(async (s) => {
          s.secret = "sensitive";
        })
        .then(async () => {}, { label: "log:step" });

      (flow as any).withRuntimeCompliance([
        {
          filter: ["log:step"],
          check: (s: any) => (s.secret ? "sensitive data detected" : null),
          onViolation: "warn",
        },
      ]);

      await (flow as any).run({});
      expect(warnings.some((w) => w.includes("sensitive data detected"))).toBe(
        true,
      );
    } finally {
      console.warn = origWarn;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compliance — scanShared (PII)
// ─────────────────────────────────────────────────────────────────────────────

describe("scanShared", () => {
  test("detects email in flat object", () => {
    const hits = scanShared({ email: "alice@example.com" });
    expect(hits.some((h) => h.pattern === "email")).toBe(true);
    expect(hits[0].path).toBe("email");
  });

  test("detects email in nested object", () => {
    const hits = scanShared({ user: { contact: { email: "bob@test.org" } } });
    expect(hits.some((h) => h.path === "user.contact.email")).toBe(true);
  });

  test("scoped paths — only checks specified keys", () => {
    const shared = {
      email: "user@example.com",
      phone: "555-867-5309",
      note: "hello",
    };
    const hits = scanShared(shared, ["email"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("email");
  });

  test("returns empty when no PII found", () => {
    const hits = scanShared({ message: "hello world", count: 42 });
    expect(hits).toHaveLength(0);
  });

  test("detects SSN", () => {
    const hits = scanShared({ id: "123-45-6789" });
    expect(hits.some((h) => h.pattern === "ssn")).toBe(true);
  });

  test("returns empty array for non-string non-object input", () => {
    expect(scanShared(42 as any)).toHaveLength(0);
    expect(scanShared(null as any)).toHaveLength(0);
    expect(scanShared(true as any)).toHaveLength(0);
  });

  test("detects PII in a string passed directly", () => {
    const hits = scanShared("reach me at alice@example.com" as any);
    expect(hits.some((h) => h.pattern === "email")).toBe(true);
    expect(hits[0].path).toBe("value");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path Analyzer — analyzeFlow (static)
// ─────────────────────────────────────────────────────────────────────────────

describe("analyzeFlow", () => {
  test("returns nodes for a linear flow", () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "step:a" })
      .then(async () => {}, { label: "step:b" });

    const map = (flow as any).analyzeFlow();
    expect(map.nodes).toHaveLength(2);
    expect(map.nodes[0].label).toBe("step:a");
    expect(map.nodes[1].label).toBe("step:b");
  });

  test("includes anchor names", () => {
    const flow = new CA<any>()
      .anchor("retry", 3)
      .then(async () => {})
      .then(async (s) => (s.done ? undefined : "#retry"));

    const map = (flow as any).analyzeFlow();
    expect(map.anchors).toContain("retry");
  });

  test("branch step has correct branch keys", () => {
    const flow = new CA<any>().branch(
      async (s) => (s.ok ? "pass" : "fail"),
      { pass: async () => {}, fail: async () => {} },
    );

    const map = (flow as any).analyzeFlow();
    const branchNode = map.nodes.find((n: any) => n.type === "branch");
    expect(branchNode).toBeDefined();
    expect(branchNode.branches).toHaveProperty("pass");
    expect(branchNode.branches).toHaveProperty("fail");
  });

  test("hasDynamicGotos is true when fn steps exist", () => {
    const flow = new CA<any>().then(async () => {});
    const map = (flow as any).analyzeFlow();
    expect(map.hasDynamicGotos).toBe(true);
  });

  test("hasDynamicGotos is false for anchor-only flow", () => {
    const flow = new CA<any>().anchor("start");
    const map = (flow as any).analyzeFlow();
    expect(map.hasDynamicGotos).toBe(false);
  });

  test("loop body is nested in the loop node", () => {
    const flow = new CA<any>().loop(
      async (s) => !s.done,
      (b) =>
        b.then(
          async (s) => {
            s.done = true;
          },
          { label: "inner:step" },
        ),
    );

    const map = (flow as any).analyzeFlow();
    const loopNode = map.nodes.find((n: any) => n.type === "loop");
    expect(loopNode).toBeDefined();
    expect(loopNode.body).toHaveLength(1);
    expect(loopNode.body[0].label).toBe("inner:step");
  });

  test("batch step has nested body nodes", () => {
    const flow = new CA<any>().batch(
      async (s) => s.items,
      (b) => b.then(async () => {}, { label: "process:item" }),
    );

    const map = (flow as any).analyzeFlow();
    const batchNode = map.nodes.find((n: any) => n.type === "batch");
    expect(batchNode).toBeDefined();
    expect(batchNode.body).toHaveLength(1);
    expect(batchNode.body[0].label).toBe("process:item");
  });

  test("parallel step has lanes array", () => {
    const flow = new CA<any>().parallel([
      async function taskA(s: any) {
        s.a = 1;
      },
      async function taskB(s: any) {
        s.b = 2;
      },
    ]);

    const map = (flow as any).analyzeFlow();
    const parallelNode = map.nodes.find((n: any) => n.type === "parallel");
    expect(parallelNode).toBeDefined();
    expect(parallelNode.parallel).toHaveLength(2);
    expect(parallelNode.parallel[0][0].label).toBe("taskA");
    expect(parallelNode.parallel[1][0].label).toBe("taskB");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path Analyzer — withTrace (runtime)
// ─────────────────────────────────────────────────────────────────────────────

describe("withTrace", () => {
  test("records visited steps", async () => {
    const flow = new CA<any>()
      .then(async () => {}, { label: "step:a" })
      .then(async () => {}, { label: "step:b" });

    const trace = (flow as any).withTrace();
    await (flow as any).run({});
    const report = trace.getTrace();

    expect(report.events).toHaveLength(2);
    expect(report.pathSummary).toEqual(["step:a", "step:b"]);
    trace.dispose();
  });

  test("dispose removes hooks — no further events collected", async () => {
    const flow = new CA<any>().then(async () => {}, {
      label: "step:a",
    });

    const trace = (flow as any).withTrace();
    trace.dispose();
    await (flow as any).run({});

    expect(trace.getTrace().events).toHaveLength(0);
  });

  test("pathSummary omits unlabelled steps", async () => {
    const flow = new CA<any>()
      .then(async () => {}) // no label
      .then(async () => {}, { label: "named" });

    const trace = (flow as any).withTrace();
    await (flow as any).run({});
    const { pathSummary } = trace.getTrace();

    expect(pathSummary).toEqual(["named"]);
    trace.dispose();
  });

  test("composable with withDryRun — records trace without executing logic", async () => {
    let sideEffect = false;
    const flow = new CA<any>().then(
      async () => {
        sideEffect = true;
      },
      { label: "risky" },
    );

    (flow as any).withDryRun();
    const trace = (flow as any).withTrace();
    await (flow as any).run({});

    expect(sideEffect).toBe(false);
    expect(trace.getTrace().pathSummary).toEqual(["risky"]);
    trace.dispose();
  });

  test("totalDurationMs is sum of event durations", async () => {
    const flow = new CA<any>()
      .then(async () => {})
      .then(async () => {});

    const trace = (flow as any).withTrace();
    await (flow as any).run({});
    const report = trace.getTrace();

    const sum = report.events.reduce(
      (s: number, e: any) => s + e.durationMs,
      0,
    );
    expect(report.totalDurationMs).toBe(sum);
    trace.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON Config — validate
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.validate", () => {
  const registry = {
    stepA: async () => {},
    stepB: async () => {},
    router: async (s: any) => s.path,
    condition: async (s: any) => !s.done,
    items: async (s: any) => s.list,
  };

  test("passes for a valid fn step config", () => {
    const result = validate({ steps: [{ type: "fn", fn: "stepA" }] }, registry);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for missing registry entry", () => {
    const result = validate(
      { steps: [{ type: "fn", fn: "missingFn" }] },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes('"missingFn" not found')),
    ).toBe(true);
  });

  test("returns error for unknown step type", () => {
    const result = validate(
      { steps: [{ type: "unknown", fn: "stepA" }] },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("unknown step type")),
    ).toBe(true);
  });

  test("returns error for missing steps array", () => {
    const result = validate({}, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "$.steps")).toBe(true);
  });

  test("validates branch router and branch fns", () => {
    const result = validate(
      {
        steps: [
          {
            type: "branch",
            router: "router",
            branches: { pass: "stepA", fail: "notInRegistry" },
          },
        ],
      },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes('"notInRegistry" not found'),
      ),
    ).toBe(true);
  });

  test("catches duplicate anchor names", () => {
    const result = validate(
      {
        steps: [
          { type: "anchor", name: "retry" },
          { type: "fn", fn: "stepA" },
          { type: "anchor", name: "retry" },
        ],
      },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes('duplicate anchor name "retry"'),
      ),
    ).toBe(true);
  });

  test("validates nested loop body", () => {
    const result = validate(
      {
        steps: [
          {
            type: "loop",
            condition: "condition",
            body: [{ type: "fn", fn: "notInRegistry" }],
          },
        ],
      },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("body"))).toBe(true);
  });

  test("step that is not an object returns error", () => {
    const result = validate({ steps: [null] }, {});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message === "must be an object")).toBe(
      true,
    );
  });

  test("step without a string type returns error", () => {
    const result = validate(
      { steps: [{ fn: "stepA" }] },
      { stepA: async () => {} },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message === "must be a string")).toBe(
      true,
    );
  });

  test("fn step with non-string fn ref returns error", () => {
    const result = validate({ steps: [{ type: "fn", fn: 99 }] }, {});
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("must be a string (registry key)"),
      ),
    ).toBe(true);
  });

  test("fn step with non-number optional field returns error", () => {
    const result = validate(
      { steps: [{ type: "fn", fn: "stepA", retries: "three" }] },
      { stepA: async () => {} },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message === "must be a number")).toBe(
      true,
    );
  });

  test("branch step with non-object branches returns error", () => {
    const result = validate(
      {
        steps: [{ type: "branch", router: "router", branches: "invalid" }],
      },
      { router: async () => {} },
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("branches") && e.message === "must be an object",
      ),
    ).toBe(true);
  });

  test("loop step with non-array body returns error", () => {
    const result = validate(
      { steps: [{ type: "loop", condition: "cond", body: "bad" }] },
      { cond: async () => {} },
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("body") && e.message === "must be an array",
      ),
    ).toBe(true);
  });

  test("batch step validates items and processor", () => {
    const result = validate(
      {
        steps: [
          {
            type: "batch",
            items: "getItems",
            processor: [{ type: "fn", fn: "process" }],
          },
        ],
      },
      { getItems: async () => [], process: async () => {} },
    );
    expect(result.valid).toBe(true);
  });

  test("batch step with invalid key type returns error", () => {
    const result = validate(
      {
        steps: [{ type: "batch", items: "getItems", key: 42, processor: [] }],
      },
      { getItems: async () => [] },
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("key") && e.message === "must be a string",
      ),
    ).toBe(true);
  });

  test("batch step with non-array processor returns error", () => {
    const result = validate(
      { steps: [{ type: "batch", items: "getItems", processor: "bad" }] },
      { getItems: async () => [] },
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("processor") && e.message === "must be an array",
      ),
    ).toBe(true);
  });

  test("parallel step with valid fns passes", () => {
    const result = validate(
      { steps: [{ type: "parallel", fns: ["stepA", "stepB"] }] },
      { stepA: async () => {}, stepB: async () => {} },
    );
    expect(result.valid).toBe(true);
  });

  test("parallel step with non-array fns returns error", () => {
    const result = validate({ steps: [{ type: "parallel", fns: "bad" }] }, {});
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("fns") && e.message === "must be an array",
      ),
    ).toBe(true);
  });

  test("anchor step with empty name returns error", () => {
    const result = validate({ steps: [{ type: "anchor", name: "" }] }, {});
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.path.includes("name") && e.message === "must be a non-empty string",
      ),
    ).toBe(true);
  });

  test("anchor step with non-number maxVisits returns error", () => {
    const result = validate(
      { steps: [{ type: "anchor", name: "retry", maxVisits: "five" }] },
      {},
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path.includes("maxVisits") && e.message === "must be a number",
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON Config — build
// ─────────────────────────────────────────────────────────────────────────────

describe("JsonFlowBuilder.build", () => {
  test("builds a runnable flow from fn steps", async () => {
    const shared: any = {};
    const registry = {
      setA: async (s: any) => {
        s.a = 1;
      },
      setB: async (s: any) => {
        s.b = 2;
      },
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "fn", fn: "setA" },
          { type: "fn", fn: "setB" },
        ],
      },
      registry,
    );
    await flow.run(shared);

    expect(shared.a).toBe(1);
    expect(shared.b).toBe(2);
  });

  test("throws ConfigValidationError for invalid config", () => {
    expect(() =>
      JsonFlowBuilder.build(
        { steps: [{ type: "fn", fn: "notInRegistry" }] } as any,
        {},
      ),
    ).toThrow(ConfigValidationError);
  });

  test("ConfigValidationError contains all errors", () => {
    try {
      JsonFlowBuilder.build(
        {
          steps: [
            { type: "fn", fn: "a" },
            { type: "fn", fn: "b" },
          ],
        } as any,
        {},
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toHaveLength(2);
    }
  });

  test("builds flow with branch step", async () => {
    const shared: any = { path: "fast" };
    const registry = {
      router: async (s: any) => s.path,
      fastFn: async (s: any) => {
        s.result = "fast!";
      },
      slowFn: async (s: any) => {
        s.result = "slow";
      },
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
    await (flow as any).run(shared);
    expect(shared.result).toBe("fast!");
  });

  test("builds flow with anchor", async () => {
    const shared: any = { count: 0 };
    const registry = {
      increment: async (s: any) => {
        s.count++;
      },
      check: async (s: any) => (s.count < 3 ? "#loop" : undefined),
    };

    const flow = JsonFlowBuilder.build(
      {
        steps: [
          { type: "anchor", name: "loop", maxVisits: 5 },
          { type: "fn", fn: "increment" },
          { type: "fn", fn: "check" },
        ],
      },
      registry,
    );
    await (flow as any).run(shared);
    expect(shared.count).toBe(3);
  });

  test("registerStepBuilder — custom step type is compiled", async () => {
    const shared: any = {};
    JsonFlowBuilder.registerStepBuilder(
      "customNoop",
      (_step, flow, _registry) => {
        flow.then(async (s: any) => {
          s.customRan = true;
        });
      },
    );

    const flow = JsonFlowBuilder.build(
      { steps: [{ type: "customNoop" } as any] },
      {},
    );
    await (flow as any).run(shared);
    expect(shared.customRan).toBe(true);
  });
});
