import { describe, expect, test } from "bun:test";
import {
  FlowBuilder,
  FlowError,
  InterruptError,
  Fragment,
  fragment,
} from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// startWith / then
// ─────────────────────────────────────────────────────────────────────────────

describe("startWith / then", () => {
  test("executes steps in order", async () => {
    const order: number[] = [];
    await new FlowBuilder()
      .startWith(async () => {
        order.push(1);
      })
      .then(async () => {
        order.push(2);
      })
      .then(async () => {
        order.push(3);
      })
      .run({});
    expect(order).toEqual([1, 2, 3]);
  });

  test("mutates shared state across steps", async () => {
    const s = { count: 0 };
    await new FlowBuilder<typeof s>()
      .startWith(async (s) => {
        s.count += 1;
      })
      .then(async (s) => {
        s.count += 1;
      })
      .run(s);
    expect(s.count).toBe(2);
  });

  test("startWith resets prior chain", async () => {
    const order: number[] = [];
    const flow = new FlowBuilder()
      .startWith(async () => {
        order.push(1);
      })
      .then(async () => {
        order.push(2);
      });
    // reset
    flow.startWith(async () => {
      order.push(9);
    });
    await flow.run({});
    expect(order).toEqual([9]);
  });

  test("passes params to every step", async () => {
    const seen: string[] = [];
    await new FlowBuilder<{}, { label: string }>()
      .startWith(async (_, p) => {
        seen.push(p.label);
      })
      .then(async (_, p) => {
        seen.push(p.label);
      })
      .run({}, { label: "hi" });
    expect(seen).toEqual(["hi", "hi"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// branch
// ─────────────────────────────────────────────────────────────────────────────

describe("branch", () => {
  test("routes to the matching key", async () => {
    const s = { role: "admin", msg: "" };
    await new FlowBuilder<typeof s>()
      .startWith(async () => {})
      .branch((s) => s.role, {
        admin: async (s) => {
          s.msg = "admin branch";
        },
        guest: async (s) => {
          s.msg = "guest branch";
        },
      })
      .run(s);
    expect(s.msg).toBe("admin branch");
  });

  test("falls through to default when no key matches", async () => {
    const s = { role: "superuser", msg: "" };
    await new FlowBuilder<typeof s>()
      .startWith(async () => {})
      .branch((s) => s.role, {
        admin: async (s) => {
          s.msg = "admin";
        },
        default: async (s) => {
          s.msg = "fallback";
        },
      })
      .run(s);
    expect(s.msg).toBe("fallback");
  });

  test("continues chain after branch", async () => {
    const s = { role: "admin", msg: "", done: false };
    await new FlowBuilder<typeof s>()
      .startWith(async () => {})
      .branch((s) => s.role, {
        admin: async (s) => {
          s.msg = "admin";
        },
      })
      .then(async (s) => {
        s.done = true;
      })
      .run(s);
    expect(s.done).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loop
// ─────────────────────────────────────────────────────────────────────────────

describe("loop", () => {
  test("repeats body until condition is false", async () => {
    const s = { ticks: 0 };
    await new FlowBuilder<typeof s>()
      .loop(
        (s) => s.ticks < 5,
        (b) =>
          b.startWith(async (s) => {
            s.ticks += 1;
          }),
      )
      .run(s);
    expect(s.ticks).toBe(5);
  });

  test("skips body when condition is initially false", async () => {
    const s = { ticks: 0 };
    await new FlowBuilder<typeof s>()
      .loop(
        () => false,
        (b) =>
          b.startWith(async (s) => {
            s.ticks += 1;
          }),
      )
      .run(s);
    expect(s.ticks).toBe(0);
  });

  test("continues chain after loop", async () => {
    const s = { ticks: 0, after: false };
    await new FlowBuilder<typeof s>()
      .loop(
        (s) => s.ticks < 2,
        (b) =>
          b.startWith(async (s) => {
            s.ticks += 1;
          }),
      )
      .then(async (s) => {
        s.after = true;
      })
      .run(s);
    expect(s.after).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// batch
// ─────────────────────────────────────────────────────────────────────────────

describe("batch", () => {
  test("runs processor once per item", async () => {
    const s: { numbers: number[]; results: number[]; __batchItem?: number } = {
      numbers: [1, 2, 3],
      results: [],
    };
    await new FlowBuilder<typeof s>()
      .batch(
        (s) => s.numbers,
        (b) =>
          b.startWith(async (s) => {
            s.results.push((s.__batchItem ?? 0) * 2);
          }),
      )
      .run(s);
    expect(s.results).toEqual([2, 4, 6]);
  });

  test("restores __batchItem to previous value after batch", async () => {
    const s: { items: number[]; __batchItem?: number; results: number[] } = {
      items: [10],
      __batchItem: 99,
      results: [],
    };
    await new FlowBuilder<typeof s>()
      .batch(
        (s) => s.items,
        (b) =>
          b.startWith(async (s) => {
            s.results.push(s.__batchItem!);
          }),
      )
      .run(s);
    expect(s.__batchItem).toBe(99);
  });

  test("handles an empty list", async () => {
    const s = { items: [] as number[], results: [] as number[] };
    await new FlowBuilder<typeof s>()
      .batch(
        (s) => s.items,
        (b) =>
          b.startWith(async (s) => {
            s.results.push(1);
          }),
      )
      .run(s);
    expect(s.results).toEqual([]);
  });

  test("nested batches with custom keys keep separate namespaces", async () => {
    const s: {
      groups: { name: string; members: string[] }[];
      results: string[];
      __group?: { name: string; members: string[] };
      __member?: string;
    } = {
      groups: [
        { name: "A", members: ["a1", "a2"] },
        { name: "B", members: ["b1"] },
      ],
      results: [],
    };
    await new FlowBuilder<typeof s>()
      .batch(
        (s) => s.groups,
        (b) =>
          b
            .startWith((s) => {
              // outer batch item should be accessible throughout
            })
            .batch(
              (s) => s.__group!.members,
              (inner) =>
                inner.startWith((s) => {
                  // both outer and inner batch items are accessible
                  s.results.push(`${s.__group!.name}:${s.__member!}`);
                }),
              { key: "__member" },
            ),
        { key: "__group" },
      )
      .run(s);
    expect(s.results).toEqual(["A:a1", "A:a2", "B:b1"]);
    expect(s.__group).toBeUndefined();
    expect(s.__member).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parallel
// ─────────────────────────────────────────────────────────────────────────────

describe("parallel", () => {
  test("runs all fns and writes to shared state", async () => {
    const s: { a?: string; b?: string } = {};
    await new FlowBuilder<typeof s>()
      .parallel([
        async (s) => {
          s.a = "A";
        },
        async (s) => {
          s.b = "B";
        },
      ])
      .run(s);
    expect(s.a).toBe("A");
    expect(s.b).toBe("B");
  });

  test("all fns complete before the next step", async () => {
    const s: { done: boolean; a?: string; b?: string } = { done: false };
    await new FlowBuilder<typeof s>()
      .parallel([
        async (s) => {
          await new Promise((r) => setTimeout(r, 10));
          s.a = "A";
        },
        async (s) => {
          s.b = "B";
        },
      ])
      .then(async (s) => {
        s.done = true;
      })
      .run(s);
    expect(s.a).toBe("A");
    expect(s.done).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retries
// ─────────────────────────────────────────────────────────────────────────────

describe("retries", () => {
  test("retries a failing step the specified number of times", async () => {
    let attempts = 0;
    await new FlowBuilder()
      .startWith(
        async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("fail");
        },
        { retries: 3 },
      )
      .run({});
    expect(attempts).toBe(3);
  });

  test("throws after all retries are exhausted", async () => {
    let attempts = 0;
    await expect(
      new FlowBuilder()
        .startWith(
          async () => {
            attempts += 1;
            throw new Error("always fail");
          },
          { retries: 2 },
        )
        .run({}),
    ).rejects.toBeInstanceOf(FlowError);
    expect(attempts).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FlowError
// ─────────────────────────────────────────────────────────────────────────────

describe("FlowError", () => {
  test("wraps plain step errors with index label", async () => {
    let caught: FlowError | undefined;
    try {
      await new FlowBuilder()
        .startWith(async () => {})
        .then(async () => {
          throw new Error("boom");
        })
        .run({});
    } catch (err) {
      caught = err as FlowError;
    }
    expect(caught).toBeInstanceOf(FlowError);
    expect(caught!.step).toBe("step 1");
    expect((caught!.cause as Error).message).toBe("boom");
  });

  test("wraps loop body errors with loop label", async () => {
    let caught: FlowError | undefined;
    try {
      await new FlowBuilder<{ i: number }>()
        .loop(
          (s) => s.i < 5,
          (b) =>
            b.startWith(async (s) => {
              s.i += 1;
              if (s.i === 2) throw new Error("loop-boom");
            }),
        )
        .run({ i: 0 });
    } catch (err) {
      caught = err as FlowError;
    }
    expect(caught).toBeInstanceOf(FlowError);
    expect(caught!.step).toBe("loop (step 0)");
  });

  test("wraps batch processor errors with batch label", async () => {
    let caught: FlowError | undefined;
    try {
      await new FlowBuilder<{ items: number[]; __batchItem?: number }>()
        .batch(
          (s) => s.items,
          (b) =>
            b.startWith(async (s) => {
              if (s.__batchItem === 2) throw new Error("bad-item");
            }),
        )
        .run({ items: [1, 2, 3] });
    } catch (err) {
      caught = err as FlowError;
    }
    expect(caught).toBeInstanceOf(FlowError);
    expect(caught!.step).toBe("batch (step 0)");
  });

  test("does not double-wrap FlowErrors", async () => {
    let caught: FlowError | undefined;
    try {
      await new FlowBuilder()
        .startWith(async () => {
          throw new FlowError("inner", new Error("x"));
        })
        .run({});
    } catch (err) {
      caught = err as FlowError;
    }
    expect(caught!.step).toBe("inner");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin system
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin system", () => {
  test("FlowBuilder.use adds a method to the prototype", () => {
    const plugin: FlowneerPlugin = {
      noop(this: FlowBuilder) {
        return this;
      },
    };
    FlowBuilder.use(plugin);
    expect(typeof (FlowBuilder.prototype as any).noop).toBe("function");
  });

  test("plugin method is chainable and returns the builder", () => {
    const plugin: FlowneerPlugin = {
      tag(this: FlowBuilder) {
        return this;
      },
    };
    FlowBuilder.use(plugin);
    const flow = new FlowBuilder();
    const result = (flow as any).tag();
    expect(result).toBe(flow);
  });

  test("beforeStep hook fires before each step", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withBefore(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            events.push(`before:${meta.index}`);
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    await (new FlowBuilder() as any)
      .withBefore()
      .startWith(async () => {})
      .then(async () => {})
      .run({});

    expect(events).toEqual(["before:0", "before:1"]);
  });

  test("afterStep hook fires after each step", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withAfter(this: FlowBuilder) {
        (this as any)._setHooks({
          afterStep: (meta: StepMeta) => {
            events.push(`after:${meta.index}`);
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    await (new FlowBuilder() as any)
      .withAfter()
      .startWith(async () => {})
      .then(async () => {})
      .run({});

    expect(events).toEqual(["after:0", "after:1"]);
  });

  test("onError hook fires when a step throws", async () => {
    const errors: string[] = [];
    const plugin: FlowneerPlugin = {
      withErrorHook(this: FlowBuilder) {
        (this as any)._setHooks({
          onError: (_meta: StepMeta, err: unknown) => {
            errors.push((err as Error).message);
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    try {
      await (new FlowBuilder() as any)
        .withErrorHook()
        .startWith(async () => {
          throw new Error("hook-error");
        })
        .run({});
    } catch {}

    expect(errors).toEqual(["hook-error"]);
  });

  test("StepMeta exposes correct index and type", async () => {
    const metas: StepMeta[] = [];
    const plugin: FlowneerPlugin = {
      withMeta(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            metas.push({ ...meta });
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    await (new FlowBuilder<{ role: string; msg: string }>() as any)
      .withMeta()
      .startWith(async () => {})
      .branch((s: any) => s.role, { default: async () => {} })
      .run({ role: "x", msg: "" });

    expect(metas[0]).toEqual({ index: 0, type: "fn" });
    expect(metas[1]).toEqual({ index: 1, type: "branch" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent-to-agent delegation
// ─────────────────────────────────────────────────────────────────────────────

describe("agent-to-agent delegation", () => {
  test("sub-agent mutates shared state and control returns to orchestrator", async () => {
    interface S {
      value: number;
      done: boolean;
    }

    const subAgent = new FlowBuilder<S>().startWith(async (s) => {
      s.value *= 10;
    });

    const orchestrator = new FlowBuilder<S>()
      .startWith(async (s) => {
        s.value = 5;
      })
      .then(async (s) => subAgent.run(s))
      .then(async (s) => {
        s.done = true;
      });

    const s: S = { value: 0, done: false };
    await orchestrator.run(s);
    expect(s.value).toBe(50);
    expect(s.done).toBe(true);
  });

  test("parallel sub-agents each write to distinct keys", async () => {
    interface S {
      a?: string;
      b?: string;
    }

    const agentA = new FlowBuilder<S>().startWith(async (s) => {
      s.a = "from-A";
    });
    const agentB = new FlowBuilder<S>().startWith(async (s) => {
      s.b = "from-B";
    });

    const s: S = {};
    await new FlowBuilder<S>()
      .parallel([(s) => agentA.run(s), (s) => agentB.run(s)])
      .run(s);

    expect(s.a).toBe("from-A");
    expect(s.b).toBe("from-B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple plugins (no overwrite)
// ─────────────────────────────────────────────────────────────────────────────

describe("multiple plugins", () => {
  test("two plugins both receive hook calls", async () => {
    const callsA: string[] = [];
    const callsB: string[] = [];

    const pluginA: FlowneerPlugin = {
      withHookA(this: FlowBuilder) {
        (this as any)._setHooks({
          afterStep: () => {
            callsA.push("A");
          },
        });
        return this;
      },
    };
    const pluginB: FlowneerPlugin = {
      withHookB(this: FlowBuilder) {
        (this as any)._setHooks({
          afterStep: () => {
            callsB.push("B");
          },
        });
        return this;
      },
    };
    FlowBuilder.use(pluginA);
    FlowBuilder.use(pluginB);

    await (new FlowBuilder() as any)
      .withHookA()
      .withHookB()
      .startWith(async () => {})
      .run({});

    expect(callsA).toEqual(["A"]);
    expect(callsB).toEqual(["B"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Timeout
// ─────────────────────────────────────────────────────────────────────────────

describe("timeoutMs", () => {
  test("throws when step exceeds timeoutMs", async () => {
    await expect(
      new FlowBuilder()
        .startWith(
          async () => {
            await new Promise((r) => setTimeout(r, 200));
          },
          { timeoutMs: 20 },
        )
        .run({}),
    ).rejects.toThrow("timed out");
  });

  test("does not throw when step completes within timeoutMs", async () => {
    await expect(
      new FlowBuilder()
        .startWith(
          async () => {
            await new Promise((r) => setTimeout(r, 5));
          },
          { timeoutMs: 200 },
        )
        .run({}),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AbortSignal cancellation
// ─────────────────────────────────────────────────────────────────────────────

describe("AbortSignal", () => {
  test("aborts between steps when signal is already aborted", async () => {
    const order: number[] = [];
    const controller = new AbortController();
    controller.abort();

    await expect(
      new FlowBuilder()
        .startWith(async () => {
          order.push(1);
        })
        .then(async () => {
          order.push(2);
        })
        .run({}, undefined, { signal: controller.signal }),
    ).rejects.toThrow();

    expect(order).toEqual([]); // aborted before first step
  });

  test("aborts mid-flow when signal fires between steps", async () => {
    const order: number[] = [];
    const controller = new AbortController();

    const flow = new FlowBuilder()
      .startWith(async () => {
        order.push(1);
        controller.abort(); // abort after first step completes
      })
      .then(async () => {
        order.push(2);
      });

    await expect(
      flow.run({}, undefined, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(order).toEqual([1]); // second step never ran
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// afterFlow hook
// ─────────────────────────────────────────────────────────────────────────────

describe("afterFlow hook", () => {
  test("fires after successful run", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withAfterFlow(this: FlowBuilder) {
        (this as any)._setHooks({
          afterFlow: () => {
            events.push("afterFlow");
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    await (new FlowBuilder() as any)
      .withAfterFlow()
      .startWith(async () => {
        events.push("step");
      })
      .run({});

    expect(events).toEqual(["step", "afterFlow"]);
  });

  test("fires even when the flow throws", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withAfterFlowErr(this: FlowBuilder) {
        (this as any)._setHooks({
          afterFlow: () => {
            events.push("afterFlow");
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    try {
      await (new FlowBuilder() as any)
        .withAfterFlowErr()
        .startWith(async () => {
          throw new Error("boom");
        })
        .run({});
    } catch {}

    expect(events).toEqual(["afterFlow"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// anchor() + goto (#anchorName)
// ───────────────────────────────────────────────────────────────────────────────

describe("anchor + goto", () => {
  test("anchor steps are skipped (no-op markers)", async () => {
    const shared = { order: [] as string[] };
    await new FlowBuilder()
      .startWith(async (s: any) => {
        s.order.push("a");
      })
      .anchor("mid")
      .then(async (s: any) => {
        s.order.push("b");
      })
      .run(shared);
    expect(shared.order).toEqual(["a", "b"]);
  });

  test("returning #anchor jumps to that anchor", async () => {
    const shared = { count: 0, log: [] as string[] };
    await new FlowBuilder()
      .startWith(async (s: any) => {
        s.log.push("start");
      })
      .anchor("refine")
      .then(async (s: any) => {
        s.count++;
        s.log.push(`refine-${s.count}`);
        if (s.count < 3) return "#refine";
      })
      .then(async (s: any) => {
        s.log.push("done");
      })
      .run(shared);
    expect(shared.count).toBe(3);
    expect(shared.log).toEqual([
      "start",
      "refine-1",
      "refine-2",
      "refine-3",
      "done",
    ]);
  });

  test("goto to unknown anchor throws", async () => {
    const flow = new FlowBuilder().startWith(async () => "#nowhere");
    await expect(flow.run({})).rejects.toThrow(
      'goto target anchor "nowhere" not found',
    );
  });

  test("branch can return #anchor to jump", async () => {
    const shared = { count: 0 };
    await new FlowBuilder()
      .anchor("top")
      .then(async (s: any) => {
        s.count++;
      })
      .branch(async (s: any) => (s.count < 2 ? "loop" : "exit"), {
        loop: async () => "#top",
        exit: async () => {},
      })
      .run(shared);
    expect(shared.count).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parallel() with reducer
// ─────────────────────────────────────────────────────────────────────────────

describe("parallel with reducer", () => {
  test("each fn gets its own draft, reducer merges", async () => {
    const shared = { value: 0 };
    await new FlowBuilder()
      .parallel(
        [
          async (s: any) => {
            s.value += 10;
          },
          async (s: any) => {
            s.value += 20;
          },
        ],
        undefined,
        (original: any, drafts: any[]) => {
          original.value = drafts.reduce(
            (sum: number, d: any) => sum + d.value,
            0,
          );
        },
      )
      .run(shared);
    // Each draft starts at 0, so 0+10 and 0+20 → sum = 30
    expect(shared.value).toBe(30);
  });

  test("without reducer, fns mutate shared directly (backwards compat)", async () => {
    const shared = { values: [] as number[] };
    await new FlowBuilder()
      .parallel([
        async (s: any) => {
          s.values.push(1);
        },
        async (s: any) => {
          s.values.push(2);
        },
      ])
      .run(shared);
    expect(shared.values.sort()).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wrapParallelFn hook
// ─────────────────────────────────────────────────────────────────────────────

describe("wrapParallelFn hook", () => {
  test("fires for each fn in a parallel step", async () => {
    const indices: number[] = [];
    const plugin: FlowneerPlugin = {
      withPFnWrap(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapParallelFn: async (
            _meta: any,
            fnIndex: number,
            next: () => Promise<void>,
          ) => {
            indices.push(fnIndex);
            await next();
          },
        });
        return this;
      },
    };
    FlowBuilder.use(plugin);

    const shared = { values: [] as number[] };
    await (new FlowBuilder() as any)
      .withPFnWrap()
      .parallel([
        async (s: any) => s.values.push(1),
        async (s: any) => s.values.push(2),
        async (s: any) => s.values.push(3),
      ])
      .run(shared);

    expect(indices.sort()).toEqual([0, 1, 2]);
    expect(shared.values.sort()).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// InterruptError
// ─────────────────────────────────────────────────────────────────────────────

describe("InterruptError", () => {
  test("is exported and carries savedShared", () => {
    const err = new InterruptError({ foo: "bar" });
    expect(err.name).toBe("InterruptError");
    expect(err.message).toBe("Flow interrupted");
    expect(err.savedShared).toEqual({ foo: "bar" });
    expect(err instanceof Error).toBe(true);
  });

  test("is not wrapped by FlowError when thrown from a step", async () => {
    const flow = new FlowBuilder().startWith(async () => {
      throw new InterruptError({ state: 42 });
    });
    try {
      await flow.run({});
      throw new Error("should not reach");
    } catch (err) {
      expect(err instanceof InterruptError).toBe(true);
      expect((err as InterruptError).savedShared).toEqual({ state: 42 });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fragment / .add()
// ─────────────────────────────────────────────────────────────────────────────

describe("Fragment / .add()", () => {
  test("fragment() returns a Fragment instance", () => {
    const frag = fragment();
    expect(frag).toBeInstanceOf(Fragment);
    expect(frag).toBeInstanceOf(FlowBuilder);
  });

  test("splices fragment steps into the flow in order", async () => {
    const order: number[] = [];

    const middle = fragment<{ order: number[] }>()
      .then(async (s) => {
        s.order.push(2);
      })
      .then(async (s) => {
        s.order.push(3);
      });

    const shared = { order };
    await new FlowBuilder<typeof shared>()
      .then(async (s) => {
        s.order.push(1);
      })
      .add(middle)
      .then(async (s) => {
        s.order.push(4);
      })
      .run(shared);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("can add multiple fragments", async () => {
    const order: string[] = [];

    const a = fragment()
      .then(async () => {
        order.push("a1");
      })
      .then(async () => {
        order.push("a2");
      });

    const b = fragment().then(async () => {
      order.push("b1");
    });

    await new FlowBuilder()
      .then(async () => {
        order.push("start");
      })
      .add(a)
      .add(b)
      .then(async () => {
        order.push("end");
      })
      .run({});

    expect(order).toEqual(["start", "a1", "a2", "b1", "end"]);
  });

  test("fragment with loop spliced correctly", async () => {
    const shared = { count: 0 };

    const loopFrag = fragment<typeof shared>().loop(
      (s) => s.count < 3,
      (b) =>
        b.then(async (s) => {
          s.count++;
        }),
    );

    await new FlowBuilder<typeof shared>().add(loopFrag).run(shared);

    expect(shared.count).toBe(3);
  });

  test("fragment with batch spliced correctly", async () => {
    const shared = { items: [10, 20, 30], results: [] as number[] };

    const batchFrag = fragment<typeof shared>().batch(
      (s) => s.items,
      (b) =>
        b.then(async (s) => {
          s.results.push((s as any).__batchItem * 2);
        }),
    );

    await new FlowBuilder<typeof shared>().add(batchFrag).run(shared);

    expect(shared.results).toEqual([20, 40, 60]);
  });

  test("same fragment can be reused in multiple flows", async () => {
    const frag = fragment().then(async (s: any) => {
      s.x = (s.x ?? 0) + 1;
    });

    const s1 = { x: 0 };
    const s2 = { x: 10 };

    await new FlowBuilder().add(frag).run(s1);
    await new FlowBuilder().add(frag).run(s2);

    expect(s1.x).toBe(1);
    expect(s2.x).toBe(11);
  });

  test("fragment.run() throws", async () => {
    const frag = fragment().then(async () => {});
    expect(frag.run({})).rejects.toThrow("Fragment cannot be run directly");
  });

  test("fragment.stream() throws", async () => {
    const frag = fragment().then(async () => {});
    const gen = frag.stream({});
    expect(gen.next()).rejects.toThrow("Fragment cannot be streamed directly");
  });
});
