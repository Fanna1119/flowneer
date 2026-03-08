// ---------------------------------------------------------------------------
// Tests for FlowBuilder.extend() — isolated subclass plugin registration
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder, fragment } from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// FlowBuilder.extend() — basic wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("FlowBuilder.extend() — basic wiring", () => {
  test("adds plugin method to the subclass prototype", () => {
    const plugin: FlowneerPlugin = {
      myMethod(this: FlowBuilder) {
        return this;
      },
    };
    const Extended = FlowBuilder.extend([plugin]);
    expect(typeof (Extended.prototype as any).myMethod).toBe("function");
  });

  test("does NOT add the method to the base FlowBuilder prototype", () => {
    const unique = `isolated_${Math.random().toString(36).slice(2)}`;
    const plugin: FlowneerPlugin = {
      [unique](this: FlowBuilder) {
        return this;
      },
    };
    FlowBuilder.extend([plugin]);
    expect(typeof (FlowBuilder.prototype as any)[unique]).toBe("undefined");
  });

  test("plugin method is callable and returns the builder instance", () => {
    const plugin: FlowneerPlugin = {
      tag(this: FlowBuilder) {
        return this;
      },
    };
    const Tagged = FlowBuilder.extend([plugin]);
    const flow = new Tagged();
    const result = (flow as any).tag();
    expect(result).toBe(flow);
  });

  test("multiple plugins in one extend() call are all available", () => {
    const pA: FlowneerPlugin = {
      methodA(this: FlowBuilder) {
        return this;
      },
    };
    const pB: FlowneerPlugin = {
      methodB(this: FlowBuilder) {
        return this;
      },
    };
    const AB = FlowBuilder.extend([pA, pB]);
    expect(typeof (AB.prototype as any).methodA).toBe("function");
    expect(typeof (AB.prototype as any).methodB).toBe("function");
  });

  test("two extend() calls produce independent prototypes", () => {
    const pA: FlowneerPlugin = {
      onlyA(this: FlowBuilder) {
        return this;
      },
    };
    const pB: FlowneerPlugin = {
      onlyB(this: FlowBuilder) {
        return this;
      },
    };
    const FlowA = FlowBuilder.extend([pA]);
    const FlowB = FlowBuilder.extend([pB]);
    expect(typeof (FlowA.prototype as any).onlyA).toBe("function");
    expect(typeof (FlowA.prototype as any).onlyB).toBe("undefined");
    expect(typeof (FlowB.prototype as any).onlyB).toBe("function");
    expect(typeof (FlowB.prototype as any).onlyA).toBe("undefined");
  });

  test("extend() chains: sub-subclass inherits parent plugin methods", () => {
    const pA: FlowneerPlugin = {
      methodA(this: FlowBuilder) {
        return this;
      },
    };
    const pB: FlowneerPlugin = {
      methodB(this: FlowBuilder) {
        return this;
      },
    };
    const FlowA = FlowBuilder.extend([pA]);
    const FlowAB = FlowA.extend([pB]);
    expect(typeof (FlowAB.prototype as any).methodA).toBe("function");
    expect(typeof (FlowAB.prototype as any).methodB).toBe("function");
    // Parent still only has pA
    expect(typeof (FlowA.prototype as any).methodB).toBe("undefined");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook system via plugin methods
// ─────────────────────────────────────────────────────────────────────────────

describe("hook system via plugin methods", () => {
  test("beforeStep fires for each step", async () => {
    const seen: number[] = [];
    const plugin: FlowneerPlugin = {
      withBefore(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            seen.push(meta.index);
          },
        });
        return this;
      },
    };
    const B = FlowBuilder.extend([plugin]);

    await (new B() as any)
      .withBefore()
      .startWith(() => {})
      .then(() => {})
      .then(() => {})
      .run({});

    expect(seen).toEqual([0, 1, 2]);
  });

  test("afterStep fires after each step", async () => {
    const order: string[] = [];
    const plugin: FlowneerPlugin = {
      withAfter(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: () => {
            order.push("before");
          },
          afterStep: () => {
            order.push("after");
          },
        });
        return this;
      },
    };
    const A = FlowBuilder.extend([plugin]);

    await (new A() as any)
      .withAfter()
      .startWith(() => {
        order.push("step");
      })
      .run({});

    expect(order).toEqual(["before", "step", "after"]);
  });

  test("beforeFlow fires once before any step", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withFlowHooks(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeFlow: () => {
            events.push("beforeFlow");
          },
          beforeStep: () => {
            events.push("beforeStep");
          },
        });
        return this;
      },
    };
    const F = FlowBuilder.extend([plugin]);

    await (new F() as any)
      .withFlowHooks()
      .startWith(() => {})
      .then(() => {})
      .run({});

    expect(events[0]).toBe("beforeFlow");
    expect(events.filter((e) => e === "beforeFlow")).toHaveLength(1);
  });

  test("afterFlow fires once after all steps", async () => {
    const events: string[] = [];
    const plugin: FlowneerPlugin = {
      withAfterFlow(this: FlowBuilder) {
        (this as any)._setHooks({
          afterStep: () => {
            events.push("afterStep");
          },
          afterFlow: () => {
            events.push("afterFlow");
          },
        });
        return this;
      },
    };
    const AF = FlowBuilder.extend([plugin]);

    await (new AF() as any)
      .withAfterFlow()
      .startWith(() => {})
      .then(() => {})
      .run({});

    expect(events).toEqual(["afterStep", "afterStep", "afterFlow"]);
  });

  test("onError fires when step throws", async () => {
    const errors: string[] = [];
    const plugin: FlowneerPlugin = {
      withError(this: FlowBuilder) {
        (this as any)._setHooks({
          onError: (_meta: StepMeta, err: unknown) => {
            errors.push((err as Error).message);
          },
        });
        return this;
      },
    };
    const E = FlowBuilder.extend([plugin]);

    try {
      await (new E() as any)
        .withError()
        .startWith(async () => {
          throw new Error("oops");
        })
        .run({});
    } catch {}

    expect(errors).toEqual(["oops"]);
  });

  test("dispose() from _setHooks removes the hooks", async () => {
    const seen: string[] = [];
    const plugin: FlowneerPlugin = {
      withBeforeHook(this: FlowBuilder) {
        const dispose = (this as any)._setHooks({
          beforeStep: () => {
            seen.push("hook");
          },
        });
        (this as any).__disposeHook = dispose;
        return this;
      },
    };
    const D = FlowBuilder.extend([plugin]);
    const flow = (new D() as any).withBeforeHook().startWith(() => {});

    await flow.run({});
    expect(seen).toHaveLength(1);

    flow.__disposeHook();
    await flow.run({});
    expect(seen).toHaveLength(1); // unchanged after dispose
  });

  test("wrapStep wraps execution — skipping next() suppresses the step", async () => {
    const ran: boolean[] = [];
    const plugin: FlowneerPlugin = {
      withSkip(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_meta: StepMeta, _next: () => Promise<void>) => {
            // deliberately do NOT call next()
          },
        });
        return this;
      },
    };
    const Sk = FlowBuilder.extend([plugin]);

    await (new Sk() as any)
      .withSkip()
      .startWith(() => {
        ran.push(true);
      })
      .run({});

    expect(ran).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin order and composition
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin order", () => {
  test("hooks from first method call fire before hooks from second", async () => {
    const order: string[] = [];
    const plugin: FlowneerPlugin = {
      tap1(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: () => {
            order.push("p1");
          },
        });
        return this;
      },
      tap2(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: () => {
            order.push("p2");
          },
        });
        return this;
      },
    };
    const T = FlowBuilder.extend([plugin]);

    await (new T() as any)
      .tap1()
      .tap2()
      .startWith(() => {})
      .run({});
    expect(order).toEqual(["p1", "p2"]);
  });

  test("wrapStep from first plugin is outermost", async () => {
    const order: string[] = [];
    const plugin: FlowneerPlugin = {
      outer(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
            order.push("outer:before");
            await next();
            order.push("outer:after");
          },
        });
        return this;
      },
      inner(this: FlowBuilder) {
        (this as any)._setHooks({
          wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
            order.push("inner:before");
            await next();
            order.push("inner:after");
          },
        });
        return this;
      },
    };
    const W = FlowBuilder.extend([plugin]);

    await (new W() as any)
      .outer()
      .inner()
      .startWith(() => {
        order.push("step");
      })
      .run({});

    expect(order).toEqual([
      "outer:before",
      "inner:before",
      "step",
      "inner:after",
      "outer:after",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Instance isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("instance isolation", () => {
  test("different instances of the same subclass have independent hook lists", async () => {
    const seenA: string[] = [];
    const seenB: string[] = [];

    const plugin: FlowneerPlugin = {
      withCounter(this: FlowBuilder) {
        const target = this; // the specific instance
        (target as any)._setHooks({
          beforeStep: () => {
            if (target === flowA) seenA.push("A");
            else seenB.push("B");
          },
        });
        return this;
      },
    };
    const F = FlowBuilder.extend([plugin]);
    const flowA = (new F() as any).withCounter().startWith(() => {});
    const flowB = (new F() as any).withCounter().startWith(() => {});

    await flowA.run({});
    await flowB.run({});

    expect(seenA).toEqual(["A"]);
    expect(seenB).toEqual(["B"]);
  });

  test("plugin method closure state is isolated per instance", async () => {
    const plugin: FlowneerPlugin = {
      withCounter(this: FlowBuilder) {
        let ticks = 0;
        (this as any)._setHooks({
          afterStep: (_meta: StepMeta, shared: any) => {
            ticks++;
            shared.count = ticks;
          },
        });
        return this;
      },
    };
    const C = FlowBuilder.extend([plugin]);

    const s1 = { count: 0 };
    const s2 = { count: 0 };

    await (new C() as any)
      .withCounter()
      .startWith(() => {})
      .then(() => {})
      .run(s1);
    await (new C() as any)
      .withCounter()
      .startWith(() => {})
      .run(s2);

    expect(s1.count).toBe(2); // two steps
    expect(s2.count).toBe(1); // one step
  });

  test("two different extend() subclasses have fully isolated prototypes", () => {
    const pA: FlowneerPlugin = {
      methodA(this: FlowBuilder) {
        return this;
      },
    };
    const pB: FlowneerPlugin = {
      methodB(this: FlowBuilder) {
        return this;
      },
    };
    const FlowA = FlowBuilder.extend([pA]);
    const FlowB = FlowBuilder.extend([pB]);

    const a = new FlowA();
    const b = new FlowB();

    expect(typeof (a as any).methodA).toBe("function");
    expect(typeof (a as any).methodB).toBe("undefined");
    expect(typeof (b as any).methodB).toBe("function");
    expect(typeof (b as any).methodA).toBe("undefined");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin factory pattern (closure configuration)
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin factory pattern", () => {
  test("calling a method multiple times stacks closures independently", async () => {
    const seen: string[] = [];

    const plugin: FlowneerPlugin = {
      withLabel(this: FlowBuilder, label: string) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            seen.push(`${label}:${meta.index}`);
          },
        });
        return this;
      },
    };
    const L = FlowBuilder.extend([plugin]);

    await (new L() as any)
      .withLabel("alpha")
      .withLabel("beta")
      .startWith(() => {})
      .run({});

    expect(seen).toEqual(["alpha:0", "beta:0"]);
  });

  test("plugin can register wrapStep to intercept execution", async () => {
    const log: string[] = [];

    const plugin: FlowneerPlugin = {
      withLogging(this: FlowBuilder, prefix: string) {
        (this as any)._setHooks({
          wrapStep: async (meta: StepMeta, next: () => Promise<void>) => {
            log.push(`${prefix}:start:${meta.index}`);
            await next();
            log.push(`${prefix}:end:${meta.index}`);
          },
        });
        return this;
      },
    };
    const Tr = FlowBuilder.extend([plugin]);

    await (new Tr() as any)
      .withLogging("trace")
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
// Fragments + extend()
// ─────────────────────────────────────────────────────────────────────────────

describe("fragments + extend()", () => {
  test("plugin applied to parent flow fires for fragment steps embedded via .add()", async () => {
    const seen: string[] = [];

    const plugin: FlowneerPlugin = {
      withBefore(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: (meta: StepMeta) => {
            seen.push(`hook:${meta.index}`);
          },
        });
        return this;
      },
    };
    const F = FlowBuilder.extend([plugin]);

    const frag = fragment()
      .then(() => {
        seen.push("frag-step-1");
      })
      .then(() => {
        seen.push("frag-step-2");
      });

    await (new F() as any).withBefore().add(frag).run({});

    expect(seen).toEqual(["hook:0", "frag-step-1", "hook:1", "frag-step-2"]);
  });

  test("hooks persist across multiple .run() calls on the same instance", async () => {
    const seen: string[] = [];
    const plugin: FlowneerPlugin = {
      withBeforeStep(this: FlowBuilder) {
        (this as any)._setHooks({
          beforeStep: () => {
            seen.push("hook");
          },
        });
        return this;
      },
    };
    const P = FlowBuilder.extend([plugin]);
    const flow = (new P() as any).withBeforeStep().startWith(() => {
      seen.push("step");
    });

    await flow.run({});
    await flow.run({});

    expect(seen).toEqual(["hook", "step", "hook", "step"]);
  });
});
