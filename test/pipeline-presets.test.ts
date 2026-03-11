// ---------------------------------------------------------------------------
// Tests for presets/pipeline: approvalGate, clarifyLoop
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder, InterruptError } from "../Flowneer";
import { resumeFlow } from "../plugins/agent/withHumanNode";
import { approvalGate } from "../presets/pipeline/approvalGate";
import { clarifyLoop } from "../presets/pipeline/clarifyLoop";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Run a flow and catch the first InterruptError, re-throw anything else. */
async function runUntilInterrupt<S extends object>(
  run: () => Promise<void>,
): Promise<InterruptError> {
  try {
    await run();
    throw new Error("Expected InterruptError but flow completed normally");
  } catch (e) {
    if (e instanceof InterruptError) return e;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// approvalGate
// ─────────────────────────────────────────────────────────────────────────────

describe("approvalGate", () => {
  // ── Interrupt path ─────────────────────────────────────────────────────────

  test("first run throws InterruptError", async () => {
    const flow = approvalGate();
    await expect(flow.run({ output: "hello" })).rejects.toBeInstanceOf(
      InterruptError,
    );
  });

  test("default prompt is stored on savedShared.__humanPrompt", async () => {
    const s = { output: "my result" };
    const err = await runUntilInterrupt(() => approvalGate().run(s));
    expect((err.savedShared as any).__humanPrompt).toContain(
      "Approve this output",
    );
    expect((err.savedShared as any).__humanPrompt).toContain("my result");
  });

  test("static string prompt is stored verbatim", async () => {
    const flow = approvalGate({ prompt: "Please check this." });
    const err = await runUntilInterrupt(() => flow.run({}));
    expect((err.savedShared as any).__humanPrompt).toBe("Please check this.");
  });

  test("dynamic prompt function is evaluated with shared state", async () => {
    const s: any = { draft: "draft-content" };
    const flow = approvalGate({
      prompt: (shared: any) => `Review: ${shared.draft}`,
    });
    const err = await runUntilInterrupt(() => flow.run(s));
    expect((err.savedShared as any).__humanPrompt).toBe(
      "Review: draft-content",
    );
  });

  test("skips interrupt when condition returns false", async () => {
    const s: any = { confidence: 0.9 };
    const flow = approvalGate({
      condition: (shared: any) => shared.confidence < 0.5,
    });
    // Should not throw
    await expect(flow.run(s)).resolves.toBeUndefined();
  });

  test("interrupts when condition returns true", async () => {
    const s: any = { confidence: 0.3 };
    const flow = approvalGate({
      condition: (shared: any) => shared.confidence < 0.5,
    });
    await expect(flow.run(s)).rejects.toBeInstanceOf(InterruptError);
  });

  // ── Resume path ────────────────────────────────────────────────────────────

  test('"approve" response sets shared.approved = true', async () => {
    const s: any = { output: "result" };
    const flow = approvalGate();
    const err = await runUntilInterrupt(() => flow.run(s));

    await resumeFlow(flow, err.savedShared as any, {
      __approvalResponse: "approve",
    });
    expect((err.savedShared as any).approved).toBeUndefined(); // savedShared is a snapshot
    // Instead verify via the merged state after resume
    const resumed: any = { ...err.savedShared, __approvalResponse: "approve" };
    await flow.run(resumed);
    expect(resumed.approved).toBe(true);
  });

  test('"yes" (case-insensitive) sets approved = true', async () => {
    const s: any = {};
    const flow = approvalGate();
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = { ...err.savedShared, __approvalResponse: "YES" };
    await flow.run(resumed);
    expect(resumed.approved).toBe(true);
  });

  test('"edit: <text>" sets humanEdit and approved = true', async () => {
    const s: any = {};
    const flow = approvalGate();
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = {
      ...err.savedShared,
      __approvalResponse: "edit: corrected output",
    };
    await flow.run(resumed);
    expect(resumed.approved).toBe(true);
    expect(resumed.humanEdit).toBe("corrected output");
  });

  test("reject response sets approved = false and humanFeedback", async () => {
    const s: any = {};
    const flow = approvalGate({ onReject: () => {} }); // no-op onReject so flow doesn't throw
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = {
      ...err.savedShared,
      __approvalResponse: "this needs work",
    };
    await flow.run(resumed);
    expect(resumed.approved).toBe(false);
    expect(resumed.humanFeedback).toBe("this needs work");
  });

  test("default onReject throws an error on rejection", async () => {
    const s: any = {};
    const flow = approvalGate(); // default onReject throws
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = { ...err.savedShared, __approvalResponse: "reject" };
    await expect(flow.run(resumed)).rejects.toThrow("Rejected by human");
  });

  test("custom onReject callback receives shared and feedback", async () => {
    const calls: Array<{ feedback: string }> = [];
    const flow = approvalGate({
      onReject: (_s: any, feedback?: string) => {
        calls.push({ feedback: feedback ?? "" });
      },
    });
    const s: any = {};
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = {
      ...err.savedShared,
      __approvalResponse: "not good enough",
    };
    await flow.run(resumed);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.feedback).toBe("not good enough");
  });

  test("custom responseKey is used instead of __approvalResponse", async () => {
    const flow = approvalGate({ responseKey: "__myReview" });
    const s: any = {};
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = { ...err.savedShared, __myReview: "approve" };
    await flow.run(resumed);
    expect(resumed.approved).toBe(true);
  });

  test("__approvalResponse and __humanPrompt are cleaned up after resume", async () => {
    const flow = approvalGate();
    const s: any = {};
    const err = await runUntilInterrupt(() => flow.run(s));
    const resumed: any = { ...err.savedShared, __approvalResponse: "approve" };
    await flow.run(resumed);
    expect(resumed.__approvalResponse).toBeUndefined();
    expect(resumed.__humanPrompt).toBeUndefined();
  });

  test("works when spliced with .add() into a larger flow", async () => {
    const order: string[] = [];
    const s: any = {};
    const flow = new FlowBuilder<any>()
      .startWith((s) => {
        order.push("generate");
        s.output = "draft";
      })
      .add(approvalGate({ onReject: () => {} }))
      .then((s) => {
        order.push("publish");
      });

    // First run should interrupt after "generate"
    const err = await runUntilInterrupt(() => flow.run(s));
    expect(order).toEqual(["generate"]);

    // Resume with approval — should continue to "publish"
    order.length = 0;
    await resumeFlow(
      flow,
      err.savedShared as any,
      {
        __approvalResponse: "approve",
      } as any,
    );
    // The flow re-runs from the top, so both steps run
    expect(order).toContain("generate");
    expect(order).toContain("publish");
  });

  test("savedShared contains a deep copy of state at interrupt time", async () => {
    const s: any = { nested: { value: 1 } };
    const flow = approvalGate();
    const err = await runUntilInterrupt(() => flow.run(s));
    // Mutating shared after interrupt should not affect savedShared
    s.nested.value = 999;
    expect((err.savedShared as any).nested.value).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clarifyLoop
// ─────────────────────────────────────────────────────────────────────────────

describe("clarifyLoop", () => {
  // ── No clarification needed ─────────────────────────────────────────────────

  test("completes without interrupt when evaluateFn returns false", async () => {
    const s: any = { output: "", confidence: 0.9 };
    let genCalled = 0;
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "good output";
        genCalled++;
      },
      evaluateFn: () => false,
    });
    await expect(flow.run(s)).resolves.toBeUndefined();
    expect(genCalled).toBe(1);
    expect(s.output).toBe("good output");
  });

  test("__clarifyRounds is deleted after normal completion", async () => {
    const s: any = {};
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "fine";
      },
      evaluateFn: () => false,
    });
    await flow.run(s);
    expect(s.__clarifyRounds).toBeUndefined();
  });

  test("__humanPrompt is deleted after normal completion", async () => {
    const s: any = {};
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "fine";
      },
      evaluateFn: () => false,
    });
    await flow.run(s);
    expect(s.__humanPrompt).toBeUndefined();
  });

  // ── Clarification needed ────────────────────────────────────────────────────

  test("throws InterruptError when evaluateFn returns true", async () => {
    const s: any = { output: "unclear response" };
    const flow = clarifyLoop({
      generateStep: () => {},
      evaluateFn: () => true,
    });
    await expect(flow.run(s)).rejects.toBeInstanceOf(InterruptError);
  });

  test("default clarifyPrompt is stored on __humanPrompt", async () => {
    const s: any = { output: "fuzzy answer" };
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "fuzzy answer";
      },
      evaluateFn: () => true,
    });
    const err = await runUntilInterrupt(() => flow.run(s));
    expect((err.savedShared as any).__humanPrompt).toContain(
      "unclear or low-confidence",
    );
    expect((err.savedShared as any).__humanPrompt).toContain("fuzzy answer");
  });

  test("custom static clarifyPrompt is stored verbatim", async () => {
    const s: any = {};
    const flow = clarifyLoop({
      generateStep: () => {},
      evaluateFn: () => true,
      clarifyPrompt: "Please be more specific.",
    });
    const err = await runUntilInterrupt(() => flow.run(s));
    expect((err.savedShared as any).__humanPrompt).toBe(
      "Please be more specific.",
    );
  });

  test("dynamic clarifyPrompt is evaluated with shared state", async () => {
    const s: any = { output: "partial" };
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "partial";
      },
      evaluateFn: () => true,
      clarifyPrompt: (shared: any) => `Clarify: ${shared.output}`,
    });
    const err = await runUntilInterrupt(() => flow.run(s));
    expect((err.savedShared as any).__humanPrompt).toBe("Clarify: partial");
  });

  // ── Resume / multi-round ────────────────────────────────────────────────────

  test("generateStep is called with humanClarification on resume", async () => {
    const received: string[] = [];
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        received.push(s.humanClarification ?? "<none>");
        s.output = s.humanClarification ? "better output" : "unclear";
      },
      evaluateFn: (s: any) => s.output === "unclear",
    });

    const s: any = {};
    const err = await runUntilInterrupt(() => flow.run(s));
    expect(received).toEqual(["<none>"]);

    // Resume with clarification
    const resumed: any = {
      ...err.savedShared,
      humanClarification: "more context",
    };
    await flow.run(resumed);

    expect(received).toContain("more context");
    expect(resumed.output).toBe("better output");
  });

  test("stops interrupting after maxRounds even if evaluateFn still returns true", async () => {
    let interruptCount = 0;
    let savedState: any = {};

    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "still unclear";
      },
      evaluateFn: () => true,
      maxRounds: 2,
    });

    const s: any = {};

    // Round 1
    const err1 = await runUntilInterrupt(() => flow.run(s));
    interruptCount++;
    savedState = err1.savedShared;

    // Round 2
    const err2 = await runUntilInterrupt(() =>
      flow.run({ ...savedState, humanClarification: "hint 1" }),
    );
    interruptCount++;
    savedState = err2.savedShared;

    // Round 3 — should complete without interrupt (maxRounds exhausted)
    await expect(
      flow.run({ ...savedState, humanClarification: "hint 2" }),
    ).resolves.toBeUndefined();

    expect(interruptCount).toBe(2);
  });

  test("custom evaluateFn receives shared and params", async () => {
    const calls: unknown[] = [];
    const flow = clarifyLoop({
      generateStep: () => {},
      evaluateFn: (s: any, _p: any) => {
        calls.push(s.value);
        return false;
      },
    });
    const s: any = { value: 42 };
    await flow.run(s);
    expect(calls).toEqual([42]);
  });

  // ── Default evaluateFn ──────────────────────────────────────────────────────

  test("default evaluateFn triggers when confidence < 0.7", async () => {
    const s: any = { output: "ok", confidence: 0.5 };
    const flow = clarifyLoop({
      generateStep: (shared: any) => {
        shared.output = "ok";
        shared.confidence = 0.5;
      },
    });
    await expect(flow.run(s)).rejects.toBeInstanceOf(InterruptError);
  });

  test("default evaluateFn triggers when output contains 'unclear'", async () => {
    const s: any = {};
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "I am unclear about this request";
      },
    });
    await expect(flow.run(s)).rejects.toBeInstanceOf(InterruptError);
  });

  test("default evaluateFn does not trigger when output is good", async () => {
    const s: any = {};
    const flow = clarifyLoop({
      generateStep: (s: any) => {
        s.output = "definitive answer";
        s.confidence = 0.95;
      },
    });
    await expect(flow.run(s)).resolves.toBeUndefined();
  });
});
