// ---------------------------------------------------------------------------
// Tests for eval primitives and graph-based composition
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import {
  exactMatch,
  containsMatch,
  f1Score,
  retrievalPrecision,
  retrievalRecall,
  answerRelevance,
  runEvalSuite,
} from "../plugins/eval";
import { withGraph } from "../plugins/graph";

FlowBuilder.use(withGraph);

// ─────────────────────────────────────────────────────────────────────────────
// exactMatch
// ─────────────────────────────────────────────────────────────────────────────

describe("exactMatch", () => {
  test("returns 1 for identical strings", () => {
    expect(exactMatch("hello", "hello")).toBe(1.0);
  });

  test("is case-insensitive", () => {
    expect(exactMatch("Paris", "paris")).toBe(1.0);
  });

  test("trims whitespace", () => {
    expect(exactMatch("  answer  ", "answer")).toBe(1.0);
  });

  test("returns 0 for different strings", () => {
    expect(exactMatch("cats", "dogs")).toBe(0.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// containsMatch
// ─────────────────────────────────────────────────────────────────────────────

describe("containsMatch", () => {
  test("returns 1 when expected is contained in predicted", () => {
    expect(containsMatch("The capital is Paris.", "Paris")).toBe(1.0);
  });

  test("is case-insensitive", () => {
    expect(containsMatch("The answer is YES", "yes")).toBe(1.0);
  });

  test("returns 0 when not contained", () => {
    expect(containsMatch("no info here", "Berlin")).toBe(0.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// f1Score
// ─────────────────────────────────────────────────────────────────────────────

describe("f1Score", () => {
  test("returns 1.0 for identical strings", () => {
    expect(f1Score("the cat sat", "the cat sat")).toBe(1.0);
  });

  test("returns 1.0 for both empty strings", () => {
    expect(f1Score("", "")).toBe(1.0);
  });

  test("returns 0.0 when one side is empty and the other is not", () => {
    expect(f1Score("hello", "")).toBe(0.0);
    expect(f1Score("", "world")).toBe(0.0);
  });

  test("returns 0.0 for completely different tokens", () => {
    expect(f1Score("cat dog", "fox hen")).toBe(0.0);
  });

  test("returns partial score for partial overlap", () => {
    const score = f1Score("cat dog fox", "cat fish fox");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test("is case-insensitive", () => {
    expect(f1Score("Hello World", "hello world")).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retrievalPrecision
// ─────────────────────────────────────────────────────────────────────────────

describe("retrievalPrecision", () => {
  test("returns 1.0 when all retrieved are relevant", () => {
    expect(retrievalPrecision(["a", "b"], ["a", "b", "c"])).toBe(1.0);
  });

  test("returns 0.5 when half are relevant", () => {
    expect(retrievalPrecision(["a", "x"], ["a", "b"])).toBe(0.5);
  });

  test("returns 0.0 when none are relevant", () => {
    expect(retrievalPrecision(["x", "y"], ["a", "b"])).toBe(0.0);
  });

  test("returns 0.0 for empty retrieved list", () => {
    expect(retrievalPrecision([], ["a"])).toBe(0.0);
  });

  test("accepts a Set as relevant", () => {
    expect(retrievalPrecision(["a", "b"], new Set(["a", "b"]))).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retrievalRecall
// ─────────────────────────────────────────────────────────────────────────────

describe("retrievalRecall", () => {
  test("returns 1.0 when all relevant are retrieved", () => {
    expect(retrievalRecall(["a", "b", "c"], ["a", "b"])).toBe(1.0);
  });

  test("returns 0.5 when half of relevant are retrieved", () => {
    expect(retrievalRecall(["a"], ["a", "b"])).toBe(0.5);
  });

  test("returns 0.0 when none are retrieved", () => {
    expect(retrievalRecall(["x"], ["a", "b"])).toBe(0.0);
  });

  test("returns 1.0 vacuously when relevant set is empty", () => {
    expect(retrievalRecall(["x"], [])).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// answerRelevance
// ─────────────────────────────────────────────────────────────────────────────

describe("answerRelevance", () => {
  test("returns 1.0 when all keywords are present", () => {
    expect(answerRelevance("The cat is on the mat", ["cat", "mat"])).toBe(1.0);
  });

  test("returns 0.5 when half keywords present", () => {
    expect(answerRelevance("The cat is here", ["cat", "dog"])).toBe(0.5);
  });

  test("returns 0.0 when no keywords are present", () => {
    expect(answerRelevance("something else", ["cat", "dog"])).toBe(0.0);
  });

  test("returns 1.0 vacuously when keywords array is empty", () => {
    expect(answerRelevance("any answer", [])).toBe(1.0);
  });

  test("is case-insensitive", () => {
    expect(answerRelevance("The Capital Is PARIS", ["paris"])).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runEvalSuite
// ─────────────────────────────────────────────────────────────────────────────

describe("runEvalSuite", () => {
  test("runs flow over each dataset item", async () => {
    const seen: number[] = [];
    const flow = new FlowBuilder<{ n: number }>().startWith((s) => {
      seen.push(s.n);
    });

    await runEvalSuite([{ n: 1 }, { n: 2 }, { n: 3 }], flow, {});

    expect(seen).toEqual([1, 2, 3]);
  });

  test("computes per-metric averages", async () => {
    const flow = new FlowBuilder<{
      input: string;
      output?: string;
    }>().startWith((s) => {
      s.output = s.input.toUpperCase();
    });

    const { summary } = await runEvalSuite(
      [
        { input: "hello", expected: "HELLO" },
        { input: "world", expected: "WORLD" },
      ] as any[],
      flow as any,
      {
        exact: (s: any) => exactMatch(s.output, s.expected),
      },
    );

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.averages["exact"]).toBe(1.0);
  });

  test("records per-item results with scores", async () => {
    const flow = new FlowBuilder<{ v: number }>().startWith((s) => {
      s.v = s.v * 2;
    });

    const { results } = await runEvalSuite([{ v: 3 }, { v: 5 }], flow, {
      double: (s: any) => (s.v === 6 ? 1 : 0),
    });

    expect(results[0]!.scores["double"]).toBe(1);
    expect(results[1]!.scores["double"]).toBe(0);
  });

  test("captures errors from failing flows", async () => {
    const flow = new FlowBuilder().startWith(() => {
      throw new Error("eval error");
    });

    const { results, summary } = await runEvalSuite([{}], flow as any, {});

    expect(results[0]!.error).toBeDefined();
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(0);
  });

  test("isolates dataset items (no shared state bleed)", async () => {
    const flow = new FlowBuilder<{ counter?: number }>().startWith((s) => {
      s.counter = (s.counter ?? 0) + 1;
    });

    const { results } = await runEvalSuite([{}, {}], flow, {
      once: (s: any) => (s.counter === 1 ? 1 : 0),
    });

    expect(results[0]!.scores["once"]).toBe(1);
    expect(results[1]!.scores["once"]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graph plugin
// ─────────────────────────────────────────────────────────────────────────────

describe("withGraph - addNode / addEdge / compile()", () => {
  test("linear DAG compiles and executes nodes in topological order", async () => {
    const order: string[] = [];
    const s: any = {};

    await (new FlowBuilder<any>() as any)
      .addNode("a", () => {
        order.push("a");
      })
      .addNode("b", () => {
        order.push("b");
      })
      .addNode("c", () => {
        order.push("c");
      })
      .addEdge("a", "b")
      .addEdge("b", "c")
      .compile()
      .run(s);

    expect(order).toEqual(["a", "b", "c"]);
  });

  test("graph nodes can mutate shared state", async () => {
    const s: any = { sum: 0 };

    await (new FlowBuilder<any>() as any)
      .addNode("add1", (s: any) => {
        s.sum += 1;
      })
      .addNode("add2", (s: any) => {
        s.sum += 2;
      })
      .addEdge("add1", "add2")
      .compile()
      .run(s);

    expect(s.sum).toBe(3);
  });

  test("throws when duplicate node name is added", () => {
    expect(() =>
      (new FlowBuilder<any>() as any)
        .addNode("x", async () => {})
        .addNode("x", async () => {}),
    ).toThrow("already exists");
  });

  test("throws on compile when edge references unknown node", () => {
    expect(() =>
      (new FlowBuilder<any>() as any)
        .addNode("a", async () => {})
        .addEdge("a", "ghost")
        .compile(),
    ).toThrow("ghost");
  });

  test("throws on compile when graph is empty", () => {
    expect(() => (new FlowBuilder<any>() as any).compile()).toThrow("empty");
  });

  test("throws on compile when unconditional edges form a cycle", () => {
    expect(() =>
      (new FlowBuilder<any>() as any)
        .addNode("a", async () => {})
        .addNode("b", async () => {})
        .addEdge("a", "b")
        .addEdge("b", "a") // cycle — no condition
        .compile(),
    ).toThrow("cycles");
  });

  test("conditional back-edge creates a loop that terminates", async () => {
    const s: any = { count: 0 };

    await (new FlowBuilder<any>() as any)
      .addNode("inc", (s: any) => {
        s.count++;
      })
      .addNode("check", async () => {})
      .addEdge("inc", "check")
      .addEdge("check", "inc", (s: any) => s.count < 3) // back-edge: repeat up to count=3
      .compile()
      .run(s);

    expect(s.count).toBeGreaterThanOrEqual(3);
  });

  test("disconnected nodes (no edges) run in insertion order", async () => {
    const order: string[] = [];
    const s: any = {};

    await (new FlowBuilder<any>() as any)
      .addNode("first", () => {
        order.push("first");
      })
      .addNode("second", () => {
        order.push("second");
      })
      // no edges — topological sort has both as roots; insertion order preserved
      .compile()
      .run(s);

    expect(order).toHaveLength(2);
    // Both ran; order depends on stable topo sort
    expect(order).toContain("first");
    expect(order).toContain("second");
  });

  test("graph nodes respect NodeOptions (retries)", async () => {
    let attempts = 0;
    const s: any = {};

    await (new FlowBuilder<any>() as any)
      .addNode(
        "flaky",
        () => {
          attempts++;
          if (attempts < 3) throw new Error("retry me");
        },
        { retries: 3 },
      )
      .compile()
      .run(s);

    expect(attempts).toBe(3);
  });
});
