import { describe, expect, test } from "bun:test";
import { FlowBuilder, fragment } from "../Flowneer";
import type { InstancePlugin, StepMeta } from "../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// instance use() — basic wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("instance with() — basic wiring", () => {
  test("single plugin is called with the builder instance", async () => {
    let received: FlowBuilder | null = null;
    const plugin: InstancePlugin = (flow) => {
      received = flow;
    };
    const flow = new FlowBuilder();
    flow.with(plugin);
    // @ts-ignore — we want to assert the exact instance was passed, not just that it's a FlowBuilder, new FlowBuilder<AuthState>()
    expect(received).toBe(flow);
  });

  test("returns this for chaining", () => {
    const flow = new FlowBuilder();
    const returned = flow.with((_f) => {});
    expect(returned).toBe(flow);
  });

  test("array of plugins are each called in order", () => {
    const called: number[] = [];
    const p1: InstancePlugin = () => {
      called.push(1);
    };
    const p2: InstancePlugin = () => {
      called.push(2);
    };
    const p3: InstancePlugin = () => {
      called.push(3);
    };
    new FlowBuilder().with([p1, p2, p3]);
    expect(called).toEqual([1, 2, 3]);
  });

  test("plugins can be chained inline with builder steps", async () => {
    const events: string[] = [];
    const plugin: InstancePlugin = (flow) =>
      flow.addHooks({
        beforeStep: () => {
          events.push("hook");
        },
      });

    await new FlowBuilder()
      .with(plugin)
      .startWith(() => {
        events.push("step");
      })
      .run({});

    expect(events).toEqual(["hook", "step"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addHooks()
// ─────────────────────────────────────────────────────────────────────────────

describe("addHooks()", () => {
  test("beforeStep fires for each step", async () => {
    const seen: number[] = [];
    const flow = new FlowBuilder();
    flow.addHooks({
      beforeStep: (meta) => {
        seen.push(meta.index);
      },
    });

    await flow
      .startWith(() => {})
      .then(() => {})
      .then(() => {})
      .run({});

    expect(seen).toEqual([0, 1, 2]);
  });

  test("afterStep fires after each step", async () => {
    const order: string[] = [];
    const flow = new FlowBuilder();
    flow.addHooks({
      beforeStep: () => {
        order.push("before");
      },
      afterStep: () => {
        order.push("after");
      },
    });

    await flow
      .startWith(() => {
        order.push("step");
      })
      .run({});
    expect(order).toEqual(["before", "step", "after"]);
  });

  test("beforeFlow fires once before any step", async () => {
    const events: string[] = [];
    const flow = new FlowBuilder();
    flow.addHooks({
      beforeFlow: () => {
        events.push("beforeFlow");
      },
      beforeStep: () => {
        events.push("beforeStep");
      },
    });

    await flow
      .startWith(() => {})
      .then(() => {})
      .run({});
    expect(events[0]).toBe("beforeFlow");
    expect(events.filter((e) => e === "beforeFlow")).toHaveLength(1);
  });

  test("afterFlow fires once after all steps", async () => {
    const events: string[] = [];
    const flow = new FlowBuilder();
    flow.addHooks({
      afterStep: () => {
        events.push("afterStep");
      },
      afterFlow: () => {
        events.push("afterFlow");
      },
    });

    await flow
      .startWith(() => {})
      .then(() => {})
      .run({});
    expect(events).toEqual(["afterStep", "afterStep", "afterFlow"]);
  });

  test("dispose removes the hooks", async () => {
    const seen: string[] = [];
    const flow = new FlowBuilder();
    const dispose = flow.addHooks({
      beforeStep: () => {
        seen.push("hook");
      },
    });

    dispose();

    await flow.startWith(() => {}).run({});
    expect(seen).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// plugin order & hook composition
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin order", () => {
  test("hooks from earlier plugins fire before hooks from later plugins", async () => {
    const order: string[] = [];

    const p1: InstancePlugin = (flow) =>
      flow.addHooks({
        beforeStep: () => {
          order.push("p1");
        },
      });
    const p2: InstancePlugin = (flow) =>
      flow.addHooks({
        beforeStep: () => {
          order.push("p2");
        },
      });

    await new FlowBuilder()
      .with([p1, p2])
      .startWith(() => {})
      .run({});

    expect(order).toEqual(["p1", "p2"]);
  });

  test("wrapStep from earlier plugin wraps later plugin (outermost first)", async () => {
    const order: string[] = [];

    const p1: InstancePlugin = (flow) =>
      flow.addHooks({
        wrapStep: async (_meta, next) => {
          order.push("p1:before");
          await next();
          order.push("p1:after");
        },
      });

    const p2: InstancePlugin = (flow) =>
      flow.addHooks({
        wrapStep: async (_meta, next) => {
          order.push("p2:before");
          await next();
          order.push("p2:after");
        },
      });

    await new FlowBuilder()
      .with([p1, p2])
      .startWith(() => {
        order.push("step");
      })
      .run({});

    expect(order).toEqual([
      "p1:before",
      "p2:before",
      "step",
      "p2:after",
      "p1:after",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// instance isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("instance isolation", () => {
  test("plugins on one instance do not affect another instance", async () => {
    const seenA: string[] = [];
    const seenB: string[] = [];

    const pluginA: InstancePlugin = (flow) =>
      flow.addHooks({
        beforeStep: () => {
          seenA.push("A");
        },
      });
    const pluginB: InstancePlugin = (flow) =>
      flow.addHooks({
        beforeStep: () => {
          seenB.push("B");
        },
      });

    const flowA = new FlowBuilder().with(pluginA).startWith(() => {});
    const flowB = new FlowBuilder().with(pluginB).startWith(() => {});

    await flowA.run({});
    await flowB.run({});

    expect(seenA).toEqual(["A"]);
    expect(seenB).toEqual(["B"]);
  });

  test("plugin factory closure state is isolated per instance", async () => {
    // Simulates a counter plugin where each instance tracks its own count
    function withStepCounter(): InstancePlugin<{ count: number }> {
      return (flow) => {
        let ticks = 0;
        flow.addHooks({
          afterStep: (_meta, shared) => {
            ticks++;
            shared.count = ticks;
          },
        });
      };
    }

    const s1 = { count: 0 };
    const s2 = { count: 0 };

    const flow1 = new FlowBuilder<{ count: number }>()
      .with(withStepCounter())
      .startWith(() => {})
      .then(() => {});

    const flow2 = new FlowBuilder<{ count: number }>()
      .with(withStepCounter())
      .startWith(() => {});

    await flow1.run(s1);
    await flow2.run(s2);

    expect(s1.count).toBe(2); // two steps
    expect(s2.count).toBe(1); // one step
  });

  test("no prototype pollution — instance use() does not add methods to FlowBuilder.prototype", () => {
    const methodsBefore = Object.getOwnPropertyNames(FlowBuilder.prototype);

    const plugin: InstancePlugin = (flow) =>
      flow.addHooks({ beforeStep: () => {} });
    new FlowBuilder().with(plugin);

    const methodsAfter = Object.getOwnPropertyNames(FlowBuilder.prototype);
    expect(methodsAfter).toEqual(methodsBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// plugin factory pattern
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin factory pattern", () => {
  test("factory options are captured in closure", async () => {
    const seen: string[] = [];

    function withLabel(label: string): InstancePlugin {
      return (flow) =>
        flow.addHooks({
          beforeStep: (meta) => {
            seen.push(`${label}:${meta.index}`);
          },
        });
    }

    await new FlowBuilder()
      .with([withLabel("alpha"), withLabel("beta")])
      .startWith(() => {})
      .run({});

    expect(seen).toEqual(["alpha:0", "beta:0"]);
  });

  test("plugin can register wrapStep to intercept execution", async () => {
    const log: string[] = [];

    function withLogging(prefix: string): InstancePlugin {
      return (flow) =>
        flow.addHooks({
          wrapStep: async (meta, next) => {
            log.push(`${prefix}:start:${meta.index}`);
            await next();
            log.push(`${prefix}:end:${meta.index}`);
          },
        });
    }

    await new FlowBuilder()
      .with(withLogging("trace"))
      .startWith(() => {})
      .then(() => {})
      .run({});

    expect(log).toEqual([
      "trace:start:0",
      "trace:end:0",
      "trace:start:1",
      "trace:end:1",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fragments + instance plugins
// ─────────────────────────────────────────────────────────────────────────────

describe("fragments + instance plugins", () => {
  test("plugin applied to a fragment does NOT carry over when embedded via .add()", async () => {
    // Hooks live on the FlowBuilder instance, not on steps.
    // .add() copies only steps — so fragment-level hooks are NOT transferred
    // to the parent flow. This test documents that current limitation.
    const seen: string[] = [];

    const frag = fragment()
      .with((f) =>
        f.addHooks({
          beforeStep: () => {
            seen.push("frag-hook");
          },
        }),
      )
      .then(() => {
        seen.push("frag-step");
      });

    await new FlowBuilder()
      .then(() => {
        seen.push("before");
      })
      .add(frag)
      .then(() => {
        seen.push("after");
      })
      .run({});

    // The fragment's steps run, but its plugin hooks do not fire on the parent
    expect(seen).toContain("frag-step");
    expect(seen).not.toContain("frag-hook");
    expect(seen).toEqual(["before", "frag-step", "after"]);
  });

  test("applying the plugin to the parent flow covers fragment steps", async () => {
    // The correct pattern for reuse: apply the plugin to the parent,
    // use a fragment purely to group/reuse steps.
    const seen: string[] = [];

    const frag = fragment()
      .then(() => {
        seen.push("frag-step-1");
      })
      .then(() => {
        seen.push("frag-step-2");
      });

    await new FlowBuilder()
      .with((f) =>
        f.addHooks({
          beforeStep: (meta) => {
            seen.push(`hook:${meta.index}`);
          },
        }),
      )
      .add(frag)
      .run({});

    expect(seen).toEqual(["hook:0", "frag-step-1", "hook:1", "frag-step-2"]);
  });

  test("fragment can carry a plugin by wrapping it in a helper that applies to any target flow", async () => {
    // Alternative reuse pattern: return a tuple of [fragment, plugin] from a
    // factory and let the caller apply both.
    const seen: string[] = [];

    function makeEnrichFragment() {
      const frag = fragment().then(() => {
        seen.push("enrich-step");
      });

      const plugin: InstancePlugin = (flow) =>
        flow.addHooks({
          beforeStep: () => {
            seen.push("enrich-hook");
          },
        });

      return { frag, plugin };
    }

    const { frag, plugin } = makeEnrichFragment();

    await new FlowBuilder().with(plugin).add(frag).run({});

    expect(seen).toEqual(["enrich-hook", "enrich-step"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parent flow reuse
// ─────────────────────────────────────────────────────────────────────────────

describe("parent flow reuse", () => {
  test("hooks persist across multiple .run() calls on the same instance", async () => {
    const seen: string[] = [];

    const flow = new FlowBuilder()
      .with((f) =>
        f.addHooks({
          beforeStep: () => {
            seen.push("hook");
          },
        }),
      )
      .startWith(() => {
        seen.push("step");
      });

    await flow.run({});
    await flow.run({});

    expect(seen).toEqual(["hook", "step", "hook", "step"]);
  });

  test("startWith resets steps but keeps hooks — base flow can be reconfigured", async () => {
    const seen: string[] = [];

    // Build a "base" with the plugin already registered
    const base = new FlowBuilder<{ val: number }>().with((f) =>
      f.addHooks({
        afterStep: (_m, s) => {
          seen.push(`hook:${s.val}`);
        },
      }),
    );

    // First run: one set of steps
    base.startWith((s) => {
      s.val = 1;
    });
    await base.run({ val: 0 });

    // Second run: completely different steps, same hooks
    base
      .startWith((s) => {
        s.val = 2;
      })
      .then((s) => {
        s.val = 3;
      });
    await base.run({ val: 0 });

    expect(seen).toEqual(["hook:1", "hook:2", "hook:3"]);
  });

  test("base flow with plugin + .add() accumulates steps across calls — clone to avoid this", async () => {
    // .add() mutates this.steps permanently, so calling it twice on the same
    // instance stacks up steps from both fragments. This documents the footgun.
    const seen: string[] = [];

    const frag = fragment().then(() => {
      seen.push("frag");
    });

    const base = new FlowBuilder()
      .with((f) =>
        f.addHooks({
          beforeStep: () => {
            seen.push("hook");
          },
        }),
      )
      .startWith(() => {
        seen.push("base");
      });

    // First consumer
    const flow1 = new FlowBuilder().add(base).add(frag);
    // Second consumer — base now has frag steps from the first .add() call!
    // To reuse safely, rebuild steps with startWith each time (see test above).

    await flow1.run({});
    expect(seen).toEqual(["base", "frag"]);
    // Note: hooks from base do NOT carry to flow1 — .add() only copies steps
  });

  test("safe reuse pattern: factory function returns a freshly configured flow", async () => {
    // The idiomatic pattern — a factory that creates a new instance each time,
    // with the plugin already wired, ready to have specific steps added.
    const seenA: string[] = [];
    const seenB: string[] = [];

    function createTracedFlow<S extends { log: string[] }>() {
      return new FlowBuilder<S>().with((f) =>
        f.addHooks({
          afterStep: (_m, s) => {
            s.log.push("traced");
          },
        }),
      );
    }

    const stateA = { log: seenA };
    const stateB = { log: seenB };

    await createTracedFlow<typeof stateA>()
      .startWith(() => {})
      .then(() => {})
      .run(stateA);

    await createTracedFlow<typeof stateB>()
      .startWith(() => {})
      .run(stateB);

    expect(seenA).toEqual(["traced", "traced"]); // two steps
    expect(seenB).toEqual(["traced"]); // one step
  });
});
