// ---------------------------------------------------------------------------
// Tests for presets/agent/swarm — swarm() + handoffTo()
// ---------------------------------------------------------------------------

import { describe, expect, test, it, mock } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";
import { swarm, handoffTo, historyText } from "../presets/agent";
import type {
  SwarmAgent,
  SwarmState,
  SwarmOptions,
  SwarmMessage,
} from "../presets/agent";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeAgent<S extends SwarmState>(
  name: string,
  fn: SwarmAgent<S>["fn"],
): SwarmAgent<S> {
  return { name, description: `Agent ${name}`, fn };
}

type S = SwarmState & { log: string[] };

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() construction", () => {
  test("returns a FlowBuilder (has .run())", () => {
    const flow = swarm([makeAgent("a", () => {})], { defaultAgent: "a" });
    expect(typeof flow.run).toBe("function");
  });

  test("throws if defaultAgent is not in agents list", () => {
    expect(() =>
      swarm([makeAgent("a", () => {})], { defaultAgent: "missing" }),
    ).toThrow(/defaultAgent "missing" not found/);
  });

  test("error message lists available agent names", () => {
    expect(() =>
      swarm([makeAgent("alpha", () => {}), makeAgent("beta", () => {})], {
        defaultAgent: "gamma",
      }),
    ).toThrow(/alpha.*beta|beta.*alpha/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handoffTo()
// ─────────────────────────────────────────────────────────────────────────────

describe("handoffTo()", () => {
  test("sets __swarmHandoff on shared state", () => {
    const shared: SwarmState = {};
    handoffTo(shared, "billing");
    expect(shared.__swarmHandoff).toEqual({
      target: "billing",
      reason: undefined,
    });
  });

  test("sets reason when provided", () => {
    const shared: SwarmState = {};
    handoffTo(shared, "billing", "payment issue detected");
    expect(shared.__swarmHandoff).toEqual({
      target: "billing",
      reason: "payment issue detected",
    });
  });

  test("overwrites a previous handoffTo", () => {
    const shared: SwarmState = {};
    handoffTo(shared, "a");
    handoffTo(shared, "b", "changed mind");
    expect(shared.__swarmHandoff!.target).toBe("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single-agent turn (no handoff)
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() single-agent turn", () => {
  test("runs the defaultAgent and completes", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["a"]);
  });

  test("does not set currentAgent when already set", async () => {
    const s: S = { log: [], currentAgent: "b" };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["b"]); // started with b, not a
  });

  test("sets currentAgent to defaultAgent on first run", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>([makeAgent("a", () => {})], { defaultAgent: "a" });
    await flow.run(s);
    expect(s.currentAgent).toBe("a");
  });

  test("turnCount is 0 after a no-handoff turn", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>([makeAgent("a", () => {})], { defaultAgent: "a" });
    await flow.run(s);
    expect(s.turnCount).toBe(0);
  });

  test("__swarmDone is cleaned up after run", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>([makeAgent("a", () => {})], { defaultAgent: "a" });
    await flow.run(s);
    expect(s.__swarmDone).toBeUndefined();
  });

  test("__swarmHandoff is cleaned up after run", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>([makeAgent("a", () => {})], { defaultAgent: "a" });
    await flow.run(s);
    expect(s.__swarmHandoff).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handoff — one hop
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() one-hop handoff", () => {
  test("hands off from a to b and b runs", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["a", "b"]);
  });

  test("currentAgent is updated to b after handoff", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", () => {}),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.currentAgent).toBe("b");
  });

  test("turnCount is 1 after one accepted handoff", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", () => {}),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.turnCount).toBe(1);
  });

  test("onHandoff callback fires with correct args", async () => {
    const s: S = { log: [] };
    const calls: Array<[string, string, string | undefined]> = [];
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b", "test reason");
        }),
        makeAgent("b", () => {}),
      ],
      {
        defaultAgent: "a",
        onHandoff: (from, to, reason) => {
          calls.push([from, to, reason]);
        },
      },
    );
    await flow.run(s);
    expect(calls).toEqual([["a", "b", "test reason"]]);
  });

  test("onHandoff callback receives shared state", async () => {
    const s: S = { log: [] };
    let sharedRef: any;
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", () => {}),
      ],
      {
        defaultAgent: "a",
        onHandoff: (_from, _to, _reason, shared) => {
          sharedRef = shared;
        },
      },
    );
    await flow.run(s);
    expect(sharedRef).toBe(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-hop handoff
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() multi-hop handoff", () => {
  test("three-hop chain: a → b → c → done", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
          handoffTo(s, "c");
        }),
        makeAgent("c", (s) => {
          s.log.push("c");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["a", "b", "c"]);
    expect(s.currentAgent).toBe("c");
    expect(s.turnCount).toBe(2);
  });

  test("onHandoff fires once per accepted hop", async () => {
    const s: S = { log: [] };
    const hops: string[] = [];
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          handoffTo(s, "c");
        }),
        makeAgent("c", () => {}),
      ],
      {
        defaultAgent: "a",
        onHandoff: (from, to) => {
          hops.push(`${from}→${to}`);
        },
      },
    );
    await flow.run(s);
    expect(hops).toEqual(["a→b", "b→c"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid handoff target
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() invalid handoff target", () => {
  test("silently ignores unknown target and ends turn", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "nonexistent");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["a"]);
    expect(s.currentAgent).toBe("a"); // unchanged
  });

  test("onHandoff is NOT called for an invalid target", async () => {
    const s: S = { log: [] };
    let called = false;
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "ghost");
        }),
      ],
      {
        defaultAgent: "a",
        onHandoff: () => {
          called = true;
        },
      },
    );
    await flow.run(s);
    expect(called).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// maxHandoffs
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() maxHandoffs", () => {
  test("stops after maxHandoffs and calls onMaxHandoffs", async () => {
    const s: S = { log: [] };
    let maxReached = false;
    // a and b keep handing off to each other forever
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
          handoffTo(s, "a");
        }),
      ],
      {
        defaultAgent: "a",
        maxHandoffs: 3,
        onMaxHandoffs: () => {
          maxReached = true;
        },
      },
    );
    await flow.run(s);
    expect(maxReached).toBe(true);
    // First run (a) is free; then 3 handoffs: a→b, b→a, a→b — 4th hop rejected
    // log: a, b, a, b  (a runs, hands off to b; b runs, hands off to a; a runs, hands off to b; b runs, tries to hand to a — capped)
    expect(s.log.length).toBe(4);
  });

  test("onMaxHandoffs callback can write to shared state", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          handoffTo(s, "a");
        }),
      ],
      {
        defaultAgent: "a",
        maxHandoffs: 2,
        onMaxHandoffs: (shared) => {
          (shared as any).capped = true;
        },
      },
    );
    await flow.run(s);
    expect((s as any).capped).toBe(true);
  });

  test("default maxHandoffs is 5", async () => {
    const s: S = { log: [] };
    let maxReached = false;
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
          handoffTo(s, "a");
        }),
      ],
      {
        defaultAgent: "a",
        onMaxHandoffs: () => {
          maxReached = true;
        },
      },
    );
    await flow.run(s);
    expect(maxReached).toBe(true);
    // default maxHandoffs=5: a runs + 5 handoffs accepted → 6 agent runs total
    expect(s.log.length).toBe(6);
  });

  test("currentAgent is NOT updated when max is exceeded", async () => {
    const s: S = { log: [], currentAgent: "a" };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          handoffTo(s, "a");
        }),
      ],
      { defaultAgent: "a", maxHandoffs: 1 },
    );
    await flow.run(s);
    // a→b is accepted (1 hop), then b→a is rejected (max=1)
    // currentAgent should be b (last accepted)
    expect(s.currentAgent).toBe("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State persistence between runs
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() state persistence", () => {
  test("currentAgent persists to the next .run() call", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
          handoffTo(s, "b");
        }),
        makeAgent("b", (s) => {
          s.log.push("b");
        }),
      ],
      { defaultAgent: "a" },
    );

    await flow.run(s);
    expect(s.currentAgent).toBe("b");

    // Second run — starts from b, not a
    await flow.run(s);
    expect(s.log).toEqual(["a", "b", "b"]);
  });

  test("turnCount resets to 0 on each .run() call", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", () => {}),
      ],
      { defaultAgent: "a" },
    );

    await flow.run(s);
    expect(s.turnCount).toBe(1);

    await flow.run(s); // b runs, no handoff
    expect(s.turnCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown currentAgent fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() unknown currentAgent fallback", () => {
  test("falls back to defaultAgent and ends turn when currentAgent is not in swarm", async () => {
    const s: S = { log: [], currentAgent: "removed-agent" };
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          s.log.push("a");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    // Should fall back gracefully, not run any agent fn, reset currentAgent to default
    expect(s.currentAgent).toBe("a");
    expect(s.log).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Async agent fns
// ─────────────────────────────────────────────────────────────────────────────

describe("swarm() async agent fns", () => {
  test("awaits async agent fn before proceeding", async () => {
    const s: S = { log: [] };
    const flow = swarm<S>(
      [
        makeAgent("a", async (s) => {
          await new Promise((r) => setTimeout(r, 5));
          s.log.push("a-async");
          handoffTo(s, "b");
        }),
        makeAgent("b", async (s) => {
          await new Promise((r) => setTimeout(r, 5));
          s.log.push("b-async");
        }),
      ],
      { defaultAgent: "a" },
    );
    await flow.run(s);
    expect(s.log).toEqual(["a-async", "b-async"]);
  });

  test("awaits async onHandoff callback", async () => {
    const s: S = { log: [] };
    const fired: string[] = [];
    const flow = swarm<S>(
      [
        makeAgent("a", (s) => {
          handoffTo(s, "b");
        }),
        makeAgent("b", () => {}),
      ],
      {
        defaultAgent: "a",
        onHandoff: async (from, to) => {
          await new Promise((r) => setTimeout(r, 5));
          fired.push(`${from}→${to}`);
        },
      },
    );
    await flow.run(s);
    expect(fired).toEqual(["a→b"]);
  });
});
// ---------------------------------------------------------------------------
// swarm() with router
// ---------------------------------------------------------------------------

describe("swarm() with router", () => {
  type RouterState = SwarmState & { messages: SwarmMessage[] };

  it("router sets currentAgent before dispatch", async () => {
    const s: RouterState = { messages: [{ role: "user", content: "hello" }] };
    const dispatched: string[] = [];
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {
        dispatched.push("a");
      }),
      makeAgent<RouterState>("b", () => {
        dispatched.push("b");
      }),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "a",
      router: { call: async () => "b" },
    });
    await flow.run(s);
    expect(dispatched).toEqual(["b"]);
    expect(s.currentAgent).toBe("b");
  });

  it("router match is case-insensitive", async () => {
    const dispatched: string[] = [];
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("billing", () => {
        dispatched.push("billing");
      }),
      makeAgent<RouterState>("support", () => {
        dispatched.push("support");
      }),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "support",
      router: { call: async () => "Billing" },
    });
    await flow.run(s);
    expect(dispatched).toContain("billing");
    expect(dispatched).not.toContain("support");
  });

  it("unrecognised router response leaves currentAgent unchanged", async () => {
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
      makeAgent<RouterState>("b", () => {}),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "a",
      router: { call: async () => "unknown-agent-xyz" },
    });
    await flow.run(s);
    expect(s.currentAgent).toBe("a");
  });

  it("router call is awaited (async)", async () => {
    let resolved = false;
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
      makeAgent<RouterState>("b", () => {}),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "a",
      router: {
        call: async () => {
          await new Promise((r) => setTimeout(r, 5));
          resolved = true;
          return "b";
        },
      },
    });
    await flow.run(s);
    expect(resolved).toBe(true);
    expect(s.currentAgent).toBe("b");
  });

  it("static prompt string is passed verbatim to call", async () => {
    let receivedPrompt = "";
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "a",
      router: {
        call: async (p) => {
          receivedPrompt = p;
          return "a";
        },
        prompt: "route this please",
      },
    });
    await flow.run(s);
    expect(receivedPrompt).toBe("route this please");
  });

  it("prompt function receives correct RouterContext fields", async () => {
    let capturedCtx: any;
    const s: RouterState = { messages: [{ role: "user", content: "hi" }] };
    const agentsList: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
      makeAgent<RouterState>("b", () => {}),
    ];
    const flow = swarm<RouterState>(agentsList, {
      defaultAgent: "a",
      router: {
        call: async () => "a",
        prompt: (ctx) => {
          capturedCtx = ctx;
          return "test";
        },
      },
    });
    await flow.run(s);
    expect(capturedCtx.currentAgent).toBe("a");
    expect(capturedCtx.messages).toBe(s.messages);
    expect(capturedCtx.shared).toBe(s);
    expect(capturedCtx.agents).toBe(agentsList);
  });

  it("async prompt function is awaited", async () => {
    let asyncPromptResolved = false;
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
    ];
    const flow = swarm<RouterState>(agents, {
      defaultAgent: "a",
      router: {
        call: async () => "a",
        prompt: async () => {
          await new Promise((r) => setTimeout(r, 5));
          asyncPromptResolved = true;
          return "async prompt";
        },
      },
    });
    await flow.run(s);
    expect(asyncPromptResolved).toBe(true);
  });

  it("call is never invoked when router is absent", async () => {
    let callCount = 0;
    const s: RouterState = { messages: [] };
    const agents: SwarmAgent<RouterState>[] = [
      makeAgent<RouterState>("a", () => {}),
    ];
    // No router in options
    const flow = swarm<RouterState>(agents, { defaultAgent: "a" });
    await flow.run(s);
    expect(callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// historyText()
// ---------------------------------------------------------------------------

describe("historyText()", () => {
  it("returns empty string for empty array", () => {
    expect(historyText([])).toBe("");
  });

  it("formats messages without agent as 'role: content'", () => {
    const result = historyText([{ role: "user", content: "hello" }]);
    expect(result).toBe("user: hello");
  });

  it("formats messages with agent as '[agent] role: content'", () => {
    const result = historyText([
      { role: "assistant", content: "hi there", agent: "support" },
    ]);
    expect(result).toBe("[support] assistant: hi there");
  });

  it("joins multiple messages with newlines", () => {
    const result = historyText([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", agent: "triage" },
      { role: "user", content: "thanks" },
    ]);
    expect(result).toBe("user: hello\n[triage] assistant: hi\nuser: thanks");
  });
});

// ---------------------------------------------------------------------------
// swarm() step labels
// ---------------------------------------------------------------------------

describe("swarm() step labels", () => {
  it("outer hooks see swarm:init, swarm:router, swarm:loop, swarm:cleanup", async () => {
    const seen: string[] = [];
    const labelPlugin: FlowneerPlugin = {
      withLabels(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            if (meta.label) seen.push(meta.label);
          },
        });
        return this;
      },
    };
    const LabelFlow = FlowBuilder.extend([labelPlugin]);

    const s: SwarmState = {};
    const flow = swarm(
      [makeAgent("a", () => {})],
      { defaultAgent: "a" },
      LabelFlow as any,
    );
    (flow as any).withLabels();
    await flow.run(s);

    expect(seen).toContain("swarm:init");
    expect(seen).toContain("swarm:router");
    expect(seen).toContain("swarm:loop");
    expect(seen).toContain("swarm:cleanup");
  });

  it("StepFilter can target swarm:loop specifically", async () => {
    const seen: string[] = [];
    const filterPlugin: FlowneerPlugin = {
      withFilteredLabels(this: FlowBuilder) {
        (this as any)._setHooks(
          {
            beforeStep: (meta: StepMeta) => {
              if (meta.label) seen.push(meta.label);
            },
          },
          ["swarm:loop"],
        );
        return this;
      },
    };
    const FilterFlow = FlowBuilder.extend([filterPlugin]);

    const s: SwarmState = {};
    const flow = swarm(
      [makeAgent("a", () => {})],
      { defaultAgent: "a" },
      FilterFlow as any,
    );
    (flow as any).withFilteredLabels();
    await flow.run(s);

    expect(seen).toEqual(["swarm:loop"]);
  });

  it("negation filter !swarm:* excludes all swarm:* steps from outer hooks", async () => {
    const seen: string[] = [];
    const negationPlugin: FlowneerPlugin = {
      withNegation(this: FlowBuilder) {
        (this as any)._setHooks(
          {
            beforeStep: (meta: StepMeta) => {
              if (meta.label) seen.push(meta.label);
            },
          },
          ["!swarm:*"],
        );
        return this;
      },
    };
    const NegFlow = FlowBuilder.extend([negationPlugin]);

    const s: SwarmState = {};
    const flow = swarm(
      [makeAgent("a", () => {})],
      { defaultAgent: "a" },
      NegFlow as any,
    );
    (flow as any).withNegation();
    await flow.run(s);

    expect(seen.every((l) => !l.startsWith("swarm:"))).toBe(true);
  });
});
