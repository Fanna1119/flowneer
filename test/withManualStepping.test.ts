import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import { withManualStepping } from "../plugins/persistence";
import { withGraph } from "../plugins/graph";
import { JsonFlowBuilder } from "../presets/config";
import type { StepMeta } from "../Flowneer";

const ManualFlow = FlowBuilder.extend([withManualStepping]);

type Shared = { log: string[] };

// ---------------------------------------------------------------------------
// 1. Basic: pauses before each step, continue() advances one at a time
// ---------------------------------------------------------------------------

describe("basic stepping", () => {
  test("pauses before every step and advances on continue()", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then((s) => s.log.push("a"))
      .then((s) => s.log.push("b"))
      .then((s) => s.log.push("c"));

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    // Flow is suspended before step 0
    await flow.stepper.waitUntilPaused();
    expect(flow.stepper.status).toBe("paused");
    expect(shared.log).toEqual([]);

    await flow.stepper.continue(); // step 0 runs
    expect(shared.log).toEqual(["a"]);

    await flow.stepper.waitUntilPaused();
    await flow.stepper.continue(); // step 1 runs
    expect(shared.log).toEqual(["a", "b"]);

    await flow.stepper.waitUntilPaused();
    await flow.stepper.continue(); // step 2 runs
    expect(shared.log).toEqual(["a", "b", "c"]);

    await done;
    expect(flow.stepper.status).toBe("done");
  });

  test("continue() resolves after the step body finishes", async () => {
    let stepFinished = false;
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then(async (s) => {
        await new Promise<void>((r) => setTimeout(r, 10));
        s.log.push("done");
        stepFinished = true;
      });

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    await flow.stepper.waitUntilPaused();
    await flow.stepper.continue(); // resolves only after the step body

    expect(stepFinished).toBe(true);
    expect(shared.log).toEqual(["done"]);
    await done;
  });
});

// ---------------------------------------------------------------------------
// 2. pausedAt exposes correct StepMeta
// ---------------------------------------------------------------------------

describe("pausedAt metadata", () => {
  test("exposes the correct meta for each paused step", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then((s) => s.log.push("x"), { label: "first" })
      .then((s) => s.log.push("y"), { label: "second" });

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    let meta = await flow.stepper.waitUntilPaused();
    expect(meta?.label).toBe("first");
    expect(flow.stepper.pausedAt?.label).toBe("first");
    await flow.stepper.continue();

    meta = await flow.stepper.waitUntilPaused();
    expect(meta?.label).toBe("second");
    await flow.stepper.continue();

    await done;
  });
});

// ---------------------------------------------------------------------------
// 3. waitUntilPaused() loop pattern
// ---------------------------------------------------------------------------

describe("waitUntilPaused loop", () => {
  test("drives all steps via the loop pattern, returns null when done", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then((s) => s.log.push("1"))
      .then((s) => s.log.push("2"))
      .then((s) => s.log.push("3"));

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    const visited: (StepMeta | null)[] = [];
    let meta: StepMeta | null;
    while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
      visited.push(meta);
      await flow.stepper.continue();
    }

    await done;
    expect(visited.length).toBe(3);
    expect(shared.log).toEqual(["1", "2", "3"]);
  });

  test("waitUntilPaused resolves immediately if already paused", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then((s) => s.log.push("x"));

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    // First wait parks correctly
    await flow.stepper.waitUntilPaused();
    // Second wait while still paused resolves immediately
    const meta = await flow.stepper.waitUntilPaused();
    expect(meta).not.toBeNull();
    expect(flow.stepper.status).toBe("paused");

    await flow.stepper.continue();
    await done;
  });

  test("waitUntilPaused resolves with null if already done", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping()
      .then((s) => s.log.push("x"));

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    await flow.stepper.waitUntilPaused();
    await flow.stepper.continue();
    await done;

    const meta = await flow.stepper.waitUntilPaused();
    expect(meta).toBeNull();
    expect(flow.stepper.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// 4. StepFilter — only pause on matching steps
// ---------------------------------------------------------------------------

describe("filter option", () => {
  test("only pauses on steps matching the filter, others run freely", async () => {
    const flow = new ManualFlow<Shared>()
      .withManualStepping({ filter: ["target"] })
      .then((s) => s.log.push("before")) // no label — runs freely
      .then((s) => s.log.push("target"), { label: "target" }) // pauses
      .then((s) => s.log.push("after")); // no label — runs freely

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    const meta = await flow.stepper.waitUntilPaused();
    // "before" should have run already
    expect(shared.log).toEqual(["before"]);
    expect(meta?.label).toBe("target");

    await flow.stepper.continue();
    await done;

    expect(shared.log).toEqual(["before", "target", "after"]);
  });
});

// ---------------------------------------------------------------------------
// 5. onPause callback
// ---------------------------------------------------------------------------

describe("onPause callback", () => {
  test("fires onPause with meta and shared before the gate blocks", async () => {
    const pauses: { label?: string; logSnapshot: string[] }[] = [];

    const flow = new ManualFlow<Shared>()
      .withManualStepping({
        onPause: (meta, shared) => {
          pauses.push({ label: meta.label, logSnapshot: [...shared.log] });
        },
      })
      .then((s) => s.log.push("a"), { label: "stepA" })
      .then((s) => s.log.push("b"), { label: "stepB" });

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    await flow.stepper.waitUntilPaused();
    expect(pauses[0]).toEqual({ label: "stepA", logSnapshot: [] });

    await flow.stepper.continue();
    await flow.stepper.waitUntilPaused();
    expect(pauses[1]).toEqual({ label: "stepB", logSnapshot: ["a"] });

    await flow.stepper.continue();
    await done;
  });
});

// ---------------------------------------------------------------------------
// 6. Error propagation — errors go through run(), not continue()
// ---------------------------------------------------------------------------

describe("error handling", () => {
  test("errors propagate through run(), continue() resolves normally", async () => {
    const flow = new ManualFlow<Shared>().withManualStepping().then(() => {
      throw new Error("boom");
    });

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    await flow.stepper.waitUntilPaused();

    // continue() should resolve (not throw) even though the step will fail
    await flow.stepper.continue();

    // The error surfaces from run()
    await expect(done).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// 7. continue() throws when not paused
// ---------------------------------------------------------------------------

describe("continue() guard", () => {
  test("throws if called when status is not 'paused'", () => {
    const flow = new ManualFlow<Shared>().withManualStepping().then((s) => {
      s.log.push("x");
    });

    expect(() => flow.stepper.continue()).toThrow("only valid when");
  });
});

// ---------------------------------------------------------------------------
// 8. Graph plugin — pauses per DAG node
// ---------------------------------------------------------------------------

const GraphManualFlow = FlowBuilder.extend([withGraph, withManualStepping]);

describe("withGraph integration", () => {
  test("pauses once per graph node in topological order", async () => {
    const flow = new GraphManualFlow<Shared>()
      .withManualStepping()
      .addNode("fetch", (s) => {
        s.log.push("fetch");
      })
      .addNode("process", (s) => {
        s.log.push("process");
      })
      .addNode("save", (s) => {
        s.log.push("save");
      })
      .addEdge("fetch", "process")
      .addEdge("process", "save")
      .compile();

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    const labels: (string | undefined)[] = [];
    let meta: StepMeta | null;
    while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
      labels.push(meta.label);
      await flow.stepper.continue();
    }

    await done;
    expect(labels).toEqual(["fetch", "process", "save"]);
    expect(shared.log).toEqual(["fetch", "process", "save"]);
  });

  test("node label exposed as pausedAt.label", async () => {
    const flow = new GraphManualFlow<Shared>()
      .withManualStepping()
      .addNode("alpha", (s) => {
        s.log.push("alpha");
      })
      .addNode("beta", (s) => {
        s.log.push("beta");
      })
      .addEdge("alpha", "beta")
      .compile();

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    await flow.stepper.waitUntilPaused();
    expect(flow.stepper.pausedAt?.label).toBe("alpha");
    await flow.stepper.continue();

    await flow.stepper.waitUntilPaused();
    expect(flow.stepper.pausedAt?.label).toBe("beta");
    await flow.stepper.continue();

    await done;
  });

  test("filter only pauses on matching node labels", async () => {
    const flow = new GraphManualFlow<Shared>()
      .withManualStepping({ filter: ["llm:generate"] })
      .addNode("fetch", (s) => {
        s.log.push("fetch");
      })
      .addNode("llm:generate", (s) => {
        s.log.push("llm:generate");
      })
      .addNode("save", (s) => {
        s.log.push("save");
      })
      .addEdge("fetch", "llm:generate")
      .addEdge("llm:generate", "save")
      .compile();

    const shared: Shared = { log: [] };
    const done = flow.run(shared);

    const meta = await flow.stepper.waitUntilPaused();
    // fetch has run freely before the pause
    expect(shared.log).toEqual(["fetch"]);
    expect(meta?.label).toBe("llm:generate");

    await flow.stepper.continue();
    await done;

    // save ran freely after continue()
    expect(shared.log).toEqual(["fetch", "llm:generate", "save"]);
  });

  test("graph with conditional back-edge pauses on each iteration", async () => {
    type CountShared = { count: number; log: string[] };

    const flow = new GraphManualFlow<CountShared>()
      .withManualStepping()
      .addNode("step", (s) => {
        s.log.push(`iter${s.count}`);
        s.count++;
      })
      .addEdge("step", "step", (s) => s.count < 3) // loop back twice
      .compile();

    const shared: CountShared = { count: 0, log: [] };
    const done = flow.run(shared);

    const labels: (string | undefined)[] = [];
    let meta: StepMeta | null;
    while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
      labels.push(meta.label);
      await flow.stepper.continue();
    }

    await done;
    // node runs 3 times (count 0→1, 1→2, 2→3; back-edge not taken at count=3)
    expect(labels.length).toBe(3);
    expect(shared.log).toEqual(["iter0", "iter1", "iter2"]);
  });
});

// ---------------------------------------------------------------------------
// 9. JsonFlowBuilder integration
// ---------------------------------------------------------------------------

// Extend with withManualStepping so JsonFlowBuilder.build() uses it as FlowClass
const ManualJsonFlow = FlowBuilder.extend([withManualStepping]);

describe("JsonFlowBuilder integration", () => {
  test("can manually step through a JSON-built flow", async () => {
    const registry = {
      fetchUser: (s: any) => {
        s.log.push("fetchUser");
      },
      transform: (s: any) => {
        s.log.push("transform");
      },
      save: (s: any) => {
        s.log.push("save");
      },
    };

    const config = {
      steps: [
        { type: "fn", fn: "fetchUser", label: "fetch" },
        { type: "fn", fn: "transform", label: "transform" },
        { type: "fn", fn: "save", label: "save" },
      ],
    };

    // Build using the extended FlowClass, then wire up manual stepping
    const flow = JsonFlowBuilder.build<{ log: string[] }>(
      config,
      registry,
      ManualJsonFlow as any,
    ) as InstanceType<typeof ManualJsonFlow>;

    flow.withManualStepping();

    const shared = { log: [] as string[] };
    const done = flow.run(shared);

    const labels: (string | undefined)[] = [];
    let meta: StepMeta | null;
    while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
      labels.push(meta.label);
      await flow.stepper.continue();
    }

    await done;
    expect(labels).toEqual(["fetch", "transform", "save"]);
    expect(shared.log).toEqual(["fetchUser", "transform", "save"]);
  });

  test("filter works on JSON-built flow step labels", async () => {
    const registry = {
      setup: (s: any) => {
        s.log.push("setup");
      },
      callLlm: (s: any) => {
        s.log.push("callLlm");
      },
      persist: (s: any) => {
        s.log.push("persist");
      },
    };

    const config = {
      steps: [
        { type: "fn", fn: "setup" },
        { type: "fn", fn: "callLlm", label: "llm:call" },
        { type: "fn", fn: "persist" },
      ],
    };

    const flow = JsonFlowBuilder.build<{ log: string[] }>(
      config,
      registry,
      ManualJsonFlow as any,
    ) as InstanceType<typeof ManualJsonFlow>;

    flow.withManualStepping({ filter: ["llm:call"] });

    const shared = { log: [] as string[] };
    const done = flow.run(shared);

    const meta = await flow.stepper.waitUntilPaused();
    // setup ran freely
    expect(shared.log).toEqual(["setup"]);
    expect(meta?.label).toBe("llm:call");

    await flow.stepper.continue();
    await done;

    // persist ran freely after continue
    expect(shared.log).toEqual(["setup", "callLlm", "persist"]);
  });
});
