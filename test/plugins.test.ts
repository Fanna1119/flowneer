import { describe, expect, test } from "bun:test";
import { FlowBuilder, FlowError } from "../Flowneer";
import {
  withTiming,
  withHistory,
  withVerbose,
  withInterrupts,
} from "../plugins/observability";
import {
  withFallback,
  withCircuitBreaker,
  withTimeout,
  withCycles,
} from "../plugins/resilience";
import {
  withCheckpoint,
  withAuditLog,
  withReplay,
  withVersionedCheckpoint,
} from "../plugins/persistence";
import {
  withTokenBudget,
  withCostTracker,
  withRateLimit,
} from "../plugins/llm";
import {
  withDryRun,
  withMocks,
  withStepLimit,
  withAtomicUpdates,
} from "../plugins/dev";
import {
  withChannels,
  sendTo,
  receiveFrom,
  peekChannel,
} from "../plugins/messaging";

FlowBuilder.use(withTiming);
FlowBuilder.use(withHistory);
FlowBuilder.use(withVerbose);
FlowBuilder.use(withInterrupts);
FlowBuilder.use(withFallback);
FlowBuilder.use(withCircuitBreaker);
FlowBuilder.use(withTimeout);
FlowBuilder.use(withCycles);
FlowBuilder.use(withCheckpoint);
FlowBuilder.use(withAuditLog);
FlowBuilder.use(withReplay);
FlowBuilder.use(withVersionedCheckpoint);
FlowBuilder.use(withTokenBudget);
FlowBuilder.use(withCostTracker);
FlowBuilder.use(withRateLimit);
FlowBuilder.use(withDryRun);
FlowBuilder.use(withMocks);
FlowBuilder.use(withStepLimit);
FlowBuilder.use(withAtomicUpdates);
FlowBuilder.use(withChannels);

// ─────────────────────────────────────────────────────────────────────────────
// beforeFlow hook
// ─────────────────────────────────────────────────────────────────────────────

describe("beforeFlow hook", () => {
  test("fires once before any step runs", async () => {
    const events: string[] = [];
    const plugin = {
      withBeforeFlow(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeFlow: () => events.push("beforeFlow"),
          beforeStep: () => events.push("beforeStep"),
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);
    await (new FlowBuilder() as any)
      .withBeforeFlow()
      .startWith(async () => {})
      .run({});
    expect(events[0]).toBe("beforeFlow");
    expect(events[1]).toBe("beforeStep");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wrapStep hook
// ─────────────────────────────────────────────────────────────────────────────

describe("wrapStep hook", () => {
  test("calling next() executes the step body", async () => {
    const ran: boolean[] = [];
    const plugin = {
      withWrap(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_meta: any, next: () => Promise<void>) => {
            await next();
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);
    await (new FlowBuilder() as any)
      .withWrap()
      .startWith(async () => {
        ran.push(true);
      })
      .run({});
    expect(ran).toEqual([true]);
  });

  test("omitting next() skips the step body", async () => {
    const ran: boolean[] = [];
    const plugin = {
      withSkip(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_meta: any, _next: () => Promise<void>) => {
            /* skip */
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);
    await (new FlowBuilder() as any)
      .withSkip()
      .startWith(async () => {
        ran.push(true);
      })
      .run({});
    expect(ran).toEqual([]);
  });

  test("multiple wrapStep hooks compose correctly (outermost registered first)", async () => {
    const order: string[] = [];
    const plugin = {
      withWrapA(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_meta: any, next: () => Promise<void>) => {
            order.push("A:before");
            await next();
            order.push("A:after");
          },
        });
        return this;
      },
      withWrapB(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_meta: any, next: () => Promise<void>) => {
            order.push("B:before");
            await next();
            order.push("B:after");
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);
    await (new FlowBuilder() as any)
      .withWrapA()
      .withWrapB()
      .startWith(async () => {
        order.push("step");
      })
      .run({});
    expect(order).toEqual([
      "A:before",
      "B:before",
      "step",
      "B:after",
      "A:after",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// observabilityPlugin — withTiming
// ─────────────────────────────────────────────────────────────────────────────

describe("withTiming", () => {
  test("populates __timings with a non-negative ms duration for each step", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withTiming()
      .startWith(async () => {})
      .then(async () => {})
      .run(s);
    expect(typeof s.__timings[0]).toBe("number");
    expect(s.__timings[0]).toBeGreaterThanOrEqual(0);
    expect(typeof s.__timings[1]).toBe("number");
  });

  test("__timings reflects actual elapsed time (rough check)", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withTiming()
      .startWith(async () => {
        await new Promise((r) => setTimeout(r, 30));
      })
      .run(s);
    expect(s.__timings[0]).toBeGreaterThanOrEqual(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// observabilityPlugin — withHistory
// ─────────────────────────────────────────────────────────────────────────────

describe("withHistory", () => {
  test("appends a snapshot entry after each step", async () => {
    const s: any = { value: 0 };
    await (new FlowBuilder<any>() as any)
      .withHistory()
      .startWith(async (s: any) => {
        s.value = 1;
      })
      .then(async (s: any) => {
        s.value = 2;
      })
      .run(s);
    expect(s.__history).toHaveLength(2);
    expect(s.__history[0].index).toBe(0);
    expect(s.__history[0].snapshot.value).toBe(1);
    expect(s.__history[1].snapshot.value).toBe(2);
  });

  test("snapshot does not include __history (avoids circular growth)", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withHistory()
      .startWith(async () => {})
      .run(s);
    expect(s.__history[0].snapshot.__history).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resiliencePlugin — withFallback
// ─────────────────────────────────────────────────────────────────────────────

describe("withFallback", () => {
  test("runs fallback when a step throws, flow continues without error", async () => {
    const s: any = { result: "" };
    await expect(
      (new FlowBuilder<any>() as any)
        .withFallback(async (s: any) => {
          s.result = "fallback";
        })
        .startWith(async () => {
          throw new Error("oops");
        })
        .then(async (s: any) => {
          s.result += ":continued";
        })
        .run(s),
    ).resolves.toBeUndefined();
    expect(s.result).toBe("fallback:continued");
  });

  test("does not fire fallback when no step throws", async () => {
    const s: any = { result: "" };
    await (new FlowBuilder<any>() as any)
      .withFallback(async (s: any) => {
        s.result = "fallback";
      })
      .startWith(async (s: any) => {
        s.result = "ok";
      })
      .run(s);
    expect(s.result).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resiliencePlugin — withCircuitBreaker
// ─────────────────────────────────────────────────────────────────────────────

describe("withCircuitBreaker", () => {
  test("opens circuit after maxFailures consecutive failures", async () => {
    let attempts = 0;
    const flow = (new FlowBuilder() as any)
      .withCircuitBreaker({ maxFailures: 2 })
      .startWith(async () => {
        attempts += 1;
        throw new Error("fail");
      })
      .then(async () => {});

    // First run: step fails once, failure count = 1
    await expect(flow.run({})).rejects.toBeInstanceOf(FlowError);
    // Second run: step fails again -> circuit opens
    await expect(flow.run({})).rejects.toBeInstanceOf(FlowError);
    // Third run: circuit is open — beforeStep throws immediately
    const err3 = await flow.run({}).catch((e: Error) => e);
    expect((err3 as FlowError).message).toMatch(/circuit open/);
    // step body ran exactly twice (not on the 3rd run)
    expect(attempts).toBe(2);
  });

  test("resets after resetMs and allows new attempts", async () => {
    let attempts = 0;
    const flow = (new FlowBuilder() as any)
      .withCircuitBreaker({ maxFailures: 1, resetMs: 30 })
      .startWith(async () => {
        attempts += 1;
        throw new Error("fail");
      });

    // Trip the circuit
    await expect(flow.run({})).rejects.toBeDefined();
    // Wait for reset window
    await new Promise((r) => setTimeout(r, 40));
    // Should allow another attempt (probe)
    await expect(flow.run({})).rejects.toBeDefined();
    expect(attempts).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resiliencePlugin — withTimeout (plugin-level)
// ─────────────────────────────────────────────────────────────────────────────

describe("withTimeout (plugin)", () => {
  test("throws when any step exceeds the timeout", async () => {
    await expect(
      (new FlowBuilder() as any)
        .withTimeout(20)
        .startWith(async () => {
          await new Promise((r) => setTimeout(r, 200));
        })
        .run({}),
    ).rejects.toThrow(/timed out/);
  });

  test("does not throw when all steps finish within the timeout", async () => {
    await expect(
      (new FlowBuilder() as any)
        .withTimeout(500)
        .startWith(async () => {
          await new Promise((r) => setTimeout(r, 5));
        })
        .run({}),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistencePlugin — withCheckpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("withCheckpoint", () => {
  test("saves shared state after each step", async () => {
    const saved: Array<{ i: number; s: unknown }> = [];
    // Real stores serialize on write; clone here to mirror that behaviour
    const store = {
      save: (i: number, s: unknown) =>
        saved.push({ i, s: JSON.parse(JSON.stringify(s)) }),
    };
    const s = { v: 0 };
    await (new FlowBuilder<typeof s>() as any)
      .withCheckpoint(store)
      .startWith(async (s: any) => {
        s.v = 1;
      })
      .then(async (s: any) => {
        s.v = 2;
      })
      .run(s);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual({ i: 0, s: { v: 1 } });
    expect(saved[1]).toEqual({ i: 1, s: { v: 2 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistencePlugin — withAuditLog
// ─────────────────────────────────────────────────────────────────────────────

describe("withAuditLog", () => {
  test("appends an entry after each successful step", async () => {
    const log: any[] = [];
    const store = { append: (e: any) => log.push(e) };
    const s = { x: 0 };
    await (new FlowBuilder<typeof s>() as any)
      .withAuditLog(store)
      .startWith(async (s: any) => {
        s.x = 42;
      })
      .run(s);
    expect(log).toHaveLength(1);
    expect(log[0].stepIndex).toBe(0);
    expect(log[0].shared.x).toBe(42);
    expect(log[0].error).toBeUndefined();
  });

  test("appends an error entry when a step throws", async () => {
    const log: any[] = [];
    const store = { append: (e: any) => log.push(e) };
    try {
      await (new FlowBuilder() as any)
        .withAuditLog(store)
        .startWith(async () => {
          throw new Error("audit-err");
        })
        .run({});
    } catch {}
    expect(log).toHaveLength(1);
    expect(log[0].error).toBe("audit-err");
  });

  test("snapshot in log is isolated from later shared mutations", async () => {
    const log: any[] = [];
    const store = { append: (e: any) => log.push(e) };
    const s: any = { v: 0 };
    await (new FlowBuilder<any>() as any)
      .withAuditLog(store)
      .startWith(async (s: any) => {
        s.v = 1;
      })
      .then(async (s: any) => {
        s.v = 2;
      })
      .run(s);
    // First entry captured at v=1; second mutation must not affect it
    expect(log[0].shared.v).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistencePlugin — withReplay
// ─────────────────────────────────────────────────────────────────────────────

describe("withReplay", () => {
  test("skips steps before fromStep and runs the rest", async () => {
    const ran: number[] = [];
    await (new FlowBuilder() as any)
      .withReplay(2)
      .startWith(async () => {
        ran.push(0);
      }) // skipped
      .then(async () => {
        ran.push(1);
      }) // skipped
      .then(async () => {
        ran.push(2);
      }) // runs
      .then(async () => {
        ran.push(3);
      }) // runs
      .run({});
    expect(ran).toEqual([2, 3]);
  });

  test("withReplay(0) runs all steps normally", async () => {
    const ran: number[] = [];
    await (new FlowBuilder() as any)
      .withReplay(0)
      .startWith(async () => {
        ran.push(0);
      })
      .then(async () => {
        ran.push(1);
      })
      .run({});
    expect(ran).toEqual([0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// llmPlugin — withTokenBudget
// ─────────────────────────────────────────────────────────────────────────────

describe("withTokenBudget", () => {
  test("does not throw while under budget", async () => {
    const s: any = { tokensUsed: 50 };
    await expect(
      (new FlowBuilder<any>() as any)
        .withTokenBudget(100)
        .startWith(async () => {})
        .run(s),
    ).resolves.toBeUndefined();
  });

  test("throws when tokensUsed reaches the limit before a step", async () => {
    const s: any = { tokensUsed: 0 };
    await expect(
      (new FlowBuilder<any>() as any)
        .withTokenBudget(10)
        .startWith(async (s: any) => {
          s.tokensUsed = 10;
        })
        .then(async () => {
          /* should not run */
        })
        .run(s),
    ).rejects.toThrow(/token budget exceeded/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// llmPlugin — withCostTracker
// ─────────────────────────────────────────────────────────────────────────────

describe("withCostTracker", () => {
  test("accumulates __stepCost into __cost and clears __stepCost", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withCostTracker()
      .startWith(async (s: any) => {
        s.__stepCost = 0.01;
      })
      .then(async (s: any) => {
        s.__stepCost = 0.02;
      })
      .run(s);
    expect(s.__cost).toBeCloseTo(0.03);
    expect(s.__stepCost).toBeUndefined();
  });

  test("__cost starts at 0 when no step sets __stepCost", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withCostTracker()
      .startWith(async () => {})
      .run(s);
    expect(s.__cost).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// llmPlugin — withRateLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("withRateLimit", () => {
  test("enforces a minimum gap between steps", async () => {
    const timestamps: number[] = [];
    await (new FlowBuilder() as any)
      .withRateLimit({ intervalMs: 30 })
      .startWith(async () => {
        timestamps.push(Date.now());
      })
      .then(async () => {
        timestamps.push(Date.now());
      })
      .then(async () => {
        timestamps.push(Date.now());
      })
      .run({});
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(25);
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// devPlugin — withDryRun
// ─────────────────────────────────────────────────────────────────────────────

describe("withDryRun", () => {
  test("skips all step bodies", async () => {
    const ran: boolean[] = [];
    await (new FlowBuilder() as any)
      .withDryRun()
      .startWith(async () => {
        ran.push(true);
      })
      .then(async () => {
        ran.push(true);
      })
      .run({});
    expect(ran).toEqual([]);
  });

  test("beforeStep and afterStep hooks still fire", async () => {
    const events: string[] = [];
    const plugin = {
      withHooksDryRun(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: () => events.push("before"),
          afterStep: () => events.push("after"),
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);
    await (new FlowBuilder() as any)
      .withDryRun()
      .withHooksDryRun()
      .startWith(async () => {
        events.push("step");
      })
      .run({});
    expect(events).toEqual(["before", "after"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// devPlugin — withMocks
// ─────────────────────────────────────────────────────────────────────────────

describe("withMocks", () => {
  test("replaces mocked steps and runs real steps normally", async () => {
    const s: any = { a: "", b: "", c: "" };
    await (new FlowBuilder<any>() as any)
      .withMocks({
        1: async (s: any) => {
          s.b = "mocked";
        },
      })
      .startWith(async (s: any) => {
        s.a = "real";
      }) // index 0 — real
      .then(async (s: any) => {
        s.b = "real";
      }) // index 1 — mocked
      .then(async (s: any) => {
        s.c = "real";
      }) // index 2 — real
      .run(s);
    expect(s.a).toBe("real");
    expect(s.b).toBe("mocked");
    expect(s.c).toBe("real");
  });

  test("empty mock map runs all steps normally", async () => {
    const ran: number[] = [];
    await (new FlowBuilder() as any)
      .withMocks({})
      .startWith(async () => {
        ran.push(0);
      })
      .then(async () => {
        ran.push(1);
      })
      .run({});
    expect(ran).toEqual([0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withStepLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("withStepLimit", () => {
  test("allows flows under the limit", async () => {
    const shared = { count: 0 };
    await (new FlowBuilder() as any)
      .withStepLimit(10)
      .startWith(async (s: any) => {
        s.count++;
      })
      .then(async (s: any) => {
        s.count++;
      })
      .run(shared);
    expect(shared.count).toBe(2);
  });

  test("throws when step count exceeds limit", async () => {
    const flow = (new FlowBuilder() as any)
      .withStepLimit(2)
      .startWith(async () => {})
      .then(async () => {})
      .then(async () => {}); // 3rd step exceeds limit of 2
    await expect(flow.run({})).rejects.toThrow("step limit exceeded");
  });

  test("counter resets between runs", async () => {
    const flow = (new FlowBuilder() as any)
      .withStepLimit(5)
      .startWith(async () => {})
      .then(async () => {});
    await flow.run({});
    await flow.run({}); // should not throw — counter reset
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withAtomicUpdates (parallelAtomic)
// ─────────────────────────────────────────────────────────────────────────────

describe("withAtomicUpdates", () => {
  test("drafts are isolated, reducer merges", async () => {
    const shared = { total: 0 };
    await (new FlowBuilder() as any)
      .parallelAtomic(
        [
          async (s: any) => {
            s.total += 5;
          },
          async (s: any) => {
            s.total += 7;
          },
        ],
        (original: any, drafts: any[]) => {
          original.total = drafts.reduce(
            (sum: number, d: any) => sum + d.total,
            0,
          );
        },
      )
      .run(shared);
    // Each draft starts at total=0, so 5 + 7 = 12
    expect(shared.total).toBe(12);
  });

  test("original shared is not mutated during parallel execution", async () => {
    const shared = { val: "original" };
    await (new FlowBuilder() as any)
      .parallelAtomic(
        [
          async (s: any) => {
            s.val = "draft-a";
          },
          async (s: any) => {
            s.val = "draft-b";
          },
        ],
        (original: any, drafts: any[]) => {
          original.val = drafts.map((d: any) => d.val).join("+");
        },
      )
      .run(shared);
    expect(shared.val).toBe("draft-a+draft-b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withCycles
// ─────────────────────────────────────────────────────────────────────────────

describe("withCycles", () => {
  test("allows flows within cycle limit", async () => {
    const shared = { count: 0 };
    await (new FlowBuilder() as any)
      .withCycles(20)
      .startWith(async (s: any) => {
        s.count++;
      })
      .then(async (s: any) => {
        s.count++;
      })
      .run(shared);
    expect(shared.count).toBe(2);
  });

  test("throws when cycle limit exceeded", async () => {
    const flow = (new FlowBuilder() as any).withCycles(3);
    flow.label("loop").then(async (s: any) => {
      s.n = (s.n ?? 0) + 1;
      return "→loop"; // forever
    });
    await expect(flow.run({ n: 0 })).rejects.toThrow("cycle limit exceeded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withInterrupts (interruptIf)
// ─────────────────────────────────────────────────────────────────────────────

describe("withInterrupts", () => {
  test("does not interrupt when condition is false", async () => {
    const shared = { step: 0 };
    await (new FlowBuilder() as any)
      .startWith(async (s: any) => {
        s.step = 1;
      })
      .interruptIf(() => false)
      .then(async (s: any) => {
        s.step = 2;
      })
      .run(shared);
    expect(shared.step).toBe(2);
  });

  test("throws InterruptError when condition is true", async () => {
    const shared = { step: 0 };
    const flow = (new FlowBuilder() as any)
      .startWith(async (s: any) => {
        s.step = 1;
      })
      .interruptIf(() => true)
      .then(async (s: any) => {
        s.step = 2;
      });
    try {
      await flow.run(shared);
      throw new Error("should not reach");
    } catch (err: any) {
      expect(err.name).toBe("InterruptError");
      expect(err.savedShared.step).toBe(1);
    }
    // step 2 was never reached
    expect(shared.step).toBe(1);
  });

  test("InterruptError carries a deep clone of shared", async () => {
    const shared = { nested: { value: 1 } };
    const flow = (new FlowBuilder() as any)
      .startWith(async (s: any) => {
        s.nested.value = 42;
      })
      .interruptIf(() => true);
    try {
      await flow.run(shared);
    } catch (err: any) {
      // Mutating saved should not affect original
      err.savedShared.nested.value = 999;
      expect(shared.nested.value).toBe(42);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withChannels (sendTo / receiveFrom)
// ─────────────────────────────────────────────────────────────────────────────

describe("withChannels", () => {
  test("sendTo and receiveFrom pass messages between steps", async () => {
    const shared: any = {};
    await (new FlowBuilder() as any)
      .withChannels()
      .startWith(async (s: any) => {
        sendTo(s, "work", { task: "A" });
        sendTo(s, "work", { task: "B" });
      })
      .then(async (s: any) => {
        const msgs = receiveFrom(s, "work");
        s.received = msgs;
      })
      .run(shared);
    expect(shared.received).toEqual([{ task: "A" }, { task: "B" }]);
  });

  test("receiveFrom drains the queue", async () => {
    const shared: any = {};
    await (new FlowBuilder() as any)
      .withChannels()
      .startWith(async (s: any) => {
        sendTo(s, "ch", 1);
        sendTo(s, "ch", 2);
      })
      .then(async (s: any) => {
        s.first = receiveFrom(s, "ch");
        s.second = receiveFrom(s, "ch"); // should be empty
      })
      .run(shared);
    expect(shared.first).toEqual([1, 2]);
    expect(shared.second).toEqual([]);
  });

  test("receiveFrom on unknown channel returns empty array", async () => {
    const shared: any = {};
    await (new FlowBuilder() as any)
      .withChannels()
      .startWith(async (s: any) => {
        s.result = receiveFrom(s, "nonexistent");
      })
      .run(shared);
    expect(shared.result).toEqual([]);
  });

  test("peekChannel does not drain", async () => {
    const shared: any = {};
    await (new FlowBuilder() as any)
      .withChannels()
      .startWith(async (s: any) => {
        sendTo(s, "ch", "msg");
      })
      .then(async (s: any) => {
        s.peeked = peekChannel(s, "ch");
        s.received = receiveFrom(s, "ch");
      })
      .run(shared);
    expect(shared.peeked).toEqual(["msg"]);
    expect(shared.received).toEqual(["msg"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withVersionedCheckpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("withVersionedCheckpoint", () => {
  test("saves diff-based entries after each step", async () => {
    const entries: any[] = [];
    const store: any = {
      save: (entry: any) => entries.push(entry),
      resolve: () => ({ stepIndex: 0, snapshot: {} }),
    };
    const shared = { a: 1 };
    await (new FlowBuilder() as any)
      .withVersionedCheckpoint(store)
      .startWith(async (s: any) => {
        s.a = 2;
      })
      .then(async (s: any) => {
        s.b = "new";
      })
      .run(shared);

    expect(entries.length).toBe(2);
    // First entry: a changed from 1 to 2
    expect(entries[0].diff.a).toBe(2);
    expect(entries[0].parentVersion).toBeNull();
    // Second entry: b added
    expect(entries[1].diff.b).toBe("new");
    expect(entries[1].parentVersion).toBe(entries[0].version);
  });

  test("skips save when nothing changed", async () => {
    const entries: any[] = [];
    const store: any = {
      save: (entry: any) => entries.push(entry),
      resolve: () => ({ stepIndex: 0, snapshot: {} }),
    };
    await (new FlowBuilder() as any)
      .withVersionedCheckpoint(store)
      .startWith(async () => {
        /* no-op */
      })
      .run({ x: 1 });
    expect(entries.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resumeFrom
// ─────────────────────────────────────────────────────────────────────────────

describe("resumeFrom", () => {
  test("skips steps at or before the saved stepIndex", async () => {
    const ran: number[] = [];
    const store: any = {
      save: () => {},
      resolve: () => ({ stepIndex: 1, snapshot: {} }),
    };
    await (new FlowBuilder() as any)
      .resumeFrom("v1", store)
      .startWith(async () => {
        ran.push(0);
      })
      .then(async () => {
        ran.push(1);
      })
      .then(async () => {
        ran.push(2);
      })
      .run({});
    // Steps 0 and 1 should be skipped (index <= 1)
    expect(ran).toEqual([2]);
  });
});
