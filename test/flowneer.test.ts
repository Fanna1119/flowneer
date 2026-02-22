import { describe, expect, test } from "bun:test";
import { FlowBuilder, FlowError } from "../Flowneer";
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
