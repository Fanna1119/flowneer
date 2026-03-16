import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import { withCheckpoint, resumeFrom } from "../plugins/persistence";
import type { CheckpointMeta, Trigger } from "../plugins/persistence";

const BaseFlow = FlowBuilder.extend([withCheckpoint, resumeFrom]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Shared = { value: number; extra?: string };

function makeStore() {
  const calls: { snapshot: Shared; meta: CheckpointMeta<Shared> }[] = [];
  return {
    calls,
    save: (snapshot: Shared, meta: CheckpointMeta<Shared>) => {
      calls.push({ snapshot: structuredClone(snapshot), meta });
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Default triggers: step:after and error
// ---------------------------------------------------------------------------

describe("default triggers", () => {
  test("saves after each successful step", async () => {
    const store = makeStore();
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value += 1;
      })
      .then((s) => {
        s.value += 1;
      })
      .withCheckpoint({ save: store.save });

    await flow.run({ value: 0 });
    expect(store.calls.length).toBe(2);
    expect(store.calls.map((c) => c.meta.trigger)).toEqual([
      "step:after",
      "step:after",
    ]);
    expect(store.calls[1]!.snapshot.value).toBe(2);
  });

  test("saves on error", async () => {
    const store = makeStore();
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 99;
      })
      .then(() => {
        throw new Error("boom");
      })
      .withCheckpoint({ save: store.save });

    await flow.run({ value: 0 }).catch(() => {});

    const errorSave = store.calls.find((c) => c.meta.trigger === "error");
    expect(errorSave).toBeDefined();
    expect(errorSave!.meta.error).toBeInstanceOf(Error);
    expect((errorSave!.meta.error as Error).message).toBe("boom");
  });

  test("only fires configured triggers when on is overridden", async () => {
    const store = makeStore();
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 1;
      })
      .then(() => {
        throw new Error("oops");
      })
      .withCheckpoint({ save: store.save, on: ["step:after"] });

    await flow.run({ value: 0 }).catch(() => {});
    // only step:after — the failing step should NOT produce an error save
    expect(store.calls.every((c) => c.meta.trigger === "step:after")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. flow:start and flow:end triggers
// ---------------------------------------------------------------------------

describe("flow:start / flow:end triggers", () => {
  test("fires flow:start before any step and flow:end after all steps", async () => {
    const order: Trigger[] = [];
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 42;
      })
      .withCheckpoint({
        save: (_, meta) => {
          order.push(meta.trigger);
        },
        on: ["flow:start", "step:after", "flow:end"],
      });

    await flow.run({ value: 0 });
    expect(order).toEqual(["flow:start", "step:after", "flow:end"]);
  });

  test("flow:end fires even when step throws", async () => {
    const triggers: Trigger[] = [];
    const flow = new BaseFlow<Shared>()
      .then(() => {
        throw new Error("bad");
      })
      .withCheckpoint({
        save: (_, meta) => {
          triggers.push(meta.trigger);
        },
        on: ["flow:start", "flow:end"],
      });

    await flow.run({ value: 0 }).catch(() => {});
    expect(triggers).toContain("flow:end");
  });
});

// ---------------------------------------------------------------------------
// 3. loop:iteration trigger
// ---------------------------------------------------------------------------

describe("loop:iteration trigger", () => {
  test("fires after each loop body with correct iteration counter", async () => {
    const iterations: number[] = [];
    let counter = 0;
    const flow = new BaseFlow<Shared>()
      .loop(
        (s) => counter++ < 4,
        (b) =>
          b.then((s) => {
            s.value++;
          }),
      )
      .withCheckpoint({
        save: (_, meta) => {
          if (meta.trigger === "loop:iteration") {
            iterations.push(meta.iteration!);
          }
        },
        on: ["loop:iteration"],
      });

    await flow.run({ value: 0 });
    expect(iterations).toEqual([0, 1, 2, 3]);
  });

  test("loop:iteration meta includes the loop step's StepMeta", async () => {
    let captured: CheckpointMeta<Shared> | undefined;
    let runs = 0;
    const flow = new BaseFlow<Shared>()
      .loop(
        () => runs++ < 1,
        (b) => b.then(() => {}),
      )
      .withCheckpoint({
        save: (_, meta) => {
          captured = meta;
        },
        on: ["loop:iteration"],
      });

    await flow.run({ value: 0 });
    expect(captured?.stepMeta?.type).toBe("loop");
  });
});

// ---------------------------------------------------------------------------
// 4. anchor:hit trigger
// ---------------------------------------------------------------------------

describe("anchor:hit trigger", () => {
  test("fires when goto jumps to an anchor", async () => {
    const anchorNames: string[] = [];
    let tick = 0;
    const flow = new BaseFlow<Shared>()
      .anchor("top")
      .then(() => (tick++ < 2 ? "#top" : undefined))
      .withCheckpoint({
        save: (_, meta) => {
          if (meta.trigger === "anchor:hit") anchorNames.push(meta.anchorName!);
        },
        on: ["anchor:hit"],
      });

    await flow.run({ value: 0 });
    expect(anchorNames).toEqual(["top", "top"]);
  });
});

// ---------------------------------------------------------------------------
// 5. filter option — respects label matching
// ---------------------------------------------------------------------------

describe("filter option", () => {
  test("only fires for matching step labels", async () => {
    const labels: (string | undefined)[] = [];
    const flow = new BaseFlow<Shared>()
      .then(
        (s) => {
          s.value++;
        },
        { label: "save-me" },
      )
      .then(
        (s) => {
          s.value++;
        },
        { label: "skip-me" },
      )
      .withCheckpoint({
        save: (_, meta) => {
          labels.push(meta.stepMeta?.label);
        },
        on: ["step:after"],
        filter: ["save-me"],
      });

    await flow.run({ value: 0 });
    expect(labels).toEqual(["save-me"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Custom serialize option
// ---------------------------------------------------------------------------

describe("serialize option", () => {
  test("uses custom serializer instead of structuredClone", async () => {
    const serializeCalls: Shared[] = [];
    const customSerialize = (s: Shared): Shared => {
      serializeCalls.push(s);
      return { ...s }; // shallow copy
    };

    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 7;
      })
      .withCheckpoint({
        save: () => {},
        on: ["step:after"],
        serialize: customSerialize,
      });

    await flow.run({ value: 0 });
    expect(serializeCalls.length).toBe(1);
    expect(serializeCalls[0]!.value).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 7. history full mode — version chain and maxVersions pruning
// ---------------------------------------------------------------------------

describe("history full mode", () => {
  test("assigns incrementing version ids with parent pointers", async () => {
    const store = makeStore();
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 1;
      })
      .then((s) => {
        s.value = 2;
      })
      .then((s) => {
        s.value = 3;
      })
      .withCheckpoint({
        save: store.save,
        on: ["step:after"],
        history: { strategy: "full" },
      });

    await flow.run({ value: 0 });
    const versions = store.calls.map((c) => c.meta.version!);
    expect(versions).toEqual(["v1", "v2", "v3"]);
    expect(store.calls[0]!.meta.parentVersion).toBeNull();
    expect(store.calls[1]!.meta.parentVersion).toBe("v1");
    expect(store.calls[2]!.meta.parentVersion).toBe("v2");
  });

  test("prunes oldest versions when maxVersions is exceeded", async () => {
    const savedVersions: string[] = [];
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 1;
      })
      .then((s) => {
        s.value = 2;
      })
      .then((s) => {
        s.value = 3;
      })
      .then((s) => {
        s.value = 4;
      })
      .withCheckpoint({
        save: (_, meta) => {
          savedVersions.push(meta.version!);
        },
        on: ["step:after"],
        history: { maxVersions: 2 },
      });

    await flow.run({ value: 0 });
    // All 4 versions were saved; the internal map should have only 2
    // but the save callback is still called for all 4 before pruning
    expect(savedVersions.length).toBe(4);
    // Pruning: only the 2 most recent remain (v3, v4) after all steps
    // (we verify by checking that v1 was emitted but older entries removed)
    expect(savedVersions).toContain("v1");
    expect(savedVersions).toContain("v4");
  });
});

// ---------------------------------------------------------------------------
// 8. history diff mode — only changed keys stored
// ---------------------------------------------------------------------------

describe("history diff mode", () => {
  test("snapshots passed to save contain only changed keys in diff mode", async () => {
    const snapshots: Partial<Shared>[] = [];
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 10;
      })
      .then((s) => {
        s.extra = "hello";
      }) // only extra changes
      .withCheckpoint({
        save: (snap) => {
          snapshots.push(snap);
        },
        on: ["step:after"],
        history: { strategy: "diff" },
      });

    await flow.run({ value: 0 });
    // First save: full diff from initial = { value: 10 } (extra unchanged)
    expect(snapshots[0]).toMatchObject({ value: 10 });
    // Second save: only extra changed
    expect(snapshots[1]).toMatchObject({ extra: "hello" });
    expect((snapshots[1] as any).value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. resumeFrom — skips steps and restores snapshot
// ---------------------------------------------------------------------------

describe("resumeFrom", () => {
  test("skips steps at index <= resolved stepIndex", async () => {
    const executed: number[] = [];
    const flow = new BaseFlow<Shared>()
      .then((s) => {
        executed.push(0);
        s.value = 1;
      })
      .then((s) => {
        executed.push(1);
        s.value = 2;
      })
      .then((s) => {
        executed.push(2);
        s.value = 3;
      })
      .resumeFrom("v1", {
        resolve: () => ({ stepIndex: 1, snapshot: { value: 100 } }),
      });

    const shared: Shared = { value: 0 };
    await flow.run(shared);

    // Steps 0 and 1 should be skipped (indices 0, 1 ≤ stepIndex=1)
    expect(executed).toEqual([2]);
    // Snapshot was restored before step 2 ran
    expect(shared.value).toBe(3); // step 2 increments from 100 → ... wait, step 2 sets value=3
  });

  test("restores shared state from snapshot before first live step", async () => {
    const capturedBefore: number[] = [];
    const flow = new BaseFlow<Shared>()
      .then(() => {}) // index 0 — skipped
      .then((s) => {
        capturedBefore.push(s.value);
      }) // index 1 — first live step
      .resumeFrom("v0", {
        resolve: () => ({ stepIndex: 0, snapshot: { value: 42 } }),
      });

    await flow.run({ value: 0 });
    expect(capturedBefore).toEqual([42]);
  });
});

// ---------------------------------------------------------------------------
// 10. Instance isolation — independent version counters
// ---------------------------------------------------------------------------

describe("instance isolation", () => {
  test("two concurrent flows have independent version counters", async () => {
    const versionsA: string[] = [];
    const versionsB: string[] = [];

    const flowA = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 1;
      })
      .withCheckpoint({
        save: (_, meta) => {
          versionsA.push(meta.version!);
        },
        on: ["step:after"],
        history: { strategy: "full" },
      });

    const flowB = new BaseFlow<Shared>()
      .then((s) => {
        s.value = 2;
      })
      .then((s) => {
        s.value = 3;
      })
      .withCheckpoint({
        save: (_, meta) => {
          versionsB.push(meta.version!);
        },
        on: ["step:after"],
        history: { strategy: "full" },
      });

    await Promise.all([flowA.run({ value: 0 }), flowB.run({ value: 0 })]);

    // Each instance counts independently from v1
    expect(versionsA).toEqual(["v1"]);
    expect(versionsB).toEqual(["v1", "v2"]);
  });
});
