// ---------------------------------------------------------------------------
// Flowneer — heavy stress test v2
//
// Pushes significantly harder than perfComplexDemo.ts across seven scenarios:
//
//  1. Nested batch-in-batch  — 200 outer × 500 inner = 100k items,
//                              each getting branch + parallel(5) + fn
//  2. Deep hook chain        — 12 registered wrapStep hooks, 50k step calls
//  3. Parallel fan-out (100) — Promise.all across 100 fns × 3k runs
//  4. stream() overhead      — same 200-step flow via .run() vs .stream()
//  5. Fragment composition   — flow assembled from 20 spliced fragments,
//                              run 20k times
//  6. Everything at once     — batch(3k) → parallel(8) → loop(5x) →
//                              branch → anchor/goto + labels + 6 active hooks
//  7. Checkpoint plugins     — withCheckpoint + withVersionedCheckpoint overhead
//                              vs plain run; resumeFrom correctness check
//
// All work is pure in-memory to isolate Flowneer's control-flow overhead.
// Run with: bun examples/perfComplexDemoV2.ts
// ---------------------------------------------------------------------------

import { FlowBuilder, fragment } from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";
import {
  withCheckpoint,
  withVersionedCheckpoint,
} from "../plugins/persistence";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hdr(title: string) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(72));
}

function stat(label: string, value: string) {
  console.log(`  ${label.padEnd(30)} ${value}`);
}

function µs(ms: number, n: number) {
  return `${((ms / n) * 1000).toFixed(2)} µs/op`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable hook-counting plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    withCounter(counters: {
      steps: number;
      wraps: number;
      parallel: number;
    }): this;
  }
}

const counterPlugin: FlowneerPlugin = {
  withCounter(
    this: FlowBuilder<any, any>,
    counters: { steps: number; wraps: number; parallel: number },
  ) {
    (this as any)._setHooks({
      beforeStep: () => {
        counters.steps++;
      },
      wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
        counters.wraps++;
        await next();
      },
      wrapParallelFn: async (
        _m: StepMeta,
        _i: number,
        next: () => Promise<void>,
      ) => {
        counters.parallel++;
        await next();
      },
    });
    return this;
  },
};
FlowBuilder.use(counterPlugin);
FlowBuilder.use(withCheckpoint);
FlowBuilder.use(withVersionedCheckpoint);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Nested batch-in-batch  (200 outer × 500 inner = 100k items total)
//    Each inner item: fn → parallel(5) → branch(even/odd)
// ─────────────────────────────────────────────────────────────────────────────

interface NestedBatchState {
  outerItems: number[];
  innerItems: number[];
  __outerItem?: number;
  __innerItem?: number;
  total: number;
}

async function demoNestedBatch() {
  const OUTER = 200;
  const INNER = 500;
  const counters = { steps: 0, wraps: 0, parallel: 0 };

  const flow = new FlowBuilder<NestedBatchState>().withCounter(counters).batch(
    (s) => s.outerItems,
    (outer) =>
      outer
        .startWith(
          (s) => {
            s.total += s.__outerItem! % 7;
          },
          { label: "outerInit" },
        )
        .batch(
          (s) => s.innerItems,
          (inner) =>
            inner
              .startWith(
                (s) => {
                  s.total += s.__innerItem! % 3;
                },
                { label: "innerInit" },
              )
              .parallel(
                [
                  (s) => {
                    s.total += 1;
                  },
                  (s) => {
                    s.total += 2;
                  },
                  (s) => {
                    s.total += 3;
                  },
                  (s) => {
                    s.total ^= 0xff;
                  },
                  (s) => {
                    s.total = (s.total >>> 0) & 0xffff;
                  },
                ],
                { label: "innerParallel" },
              )
              .branch(
                (s) => (s.total % 2 === 0 ? "even" : "odd"),
                {
                  even: (s) => {
                    s.total += 10;
                  },
                  odd: (s) => {
                    s.total -= 5;
                  },
                },
                { label: "innerBranch" },
              ),
          { key: "__innerItem" },
        ),
    { key: "__outerItem" },
  );

  const shared: NestedBatchState = {
    outerItems: Array.from({ length: OUTER }, (_, i) => i),
    innerItems: Array.from({ length: INNER }, (_, i) => i),
    total: 0,
  };

  const t0 = performance.now();
  await flow.run(shared);
  const elapsed = performance.now() - t0;
  const total = OUTER * INNER;

  hdr(
    `1. Nested batch-in-batch  (${OUTER} × ${INNER} = ${total.toLocaleString()} items)`,
  );
  stat("Total time", `${elapsed.toFixed(1)} ms`);
  stat("Per inner item", µs(elapsed, total));
  stat(
    "beforeStep calls",
    `${counters.steps} (outer steps only — hooks don\'t propagate into sub-flows)`,
  );
  stat("wrapStep calls", counters.wraps.toLocaleString());
  stat(
    "wrapParallelFn calls",
    `${counters.parallel} (plugin registered on outer builder)`,
  );
  stat("Final total", shared.total.toString());
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Deep hook chain — 12 nested wrapStep hooks, 50k individual step calls
//    Measures the overhead of the reduceRight composition chain.
// ─────────────────────────────────────────────────────────────────────────────

async function demoDeepHookChain() {
  const HOOK_DEPTH = 12;
  const STEPS = 10;
  const RUNS = 5_000;
  const total_steps = STEPS * RUNS;

  interface S {
    n: number;
  }

  const flow = new FlowBuilder<S>();

  // Register 12 wrapStep hooks — each one increments a counter
  const wrapCalls = { value: 0 };
  for (let h = 0; h < HOOK_DEPTH; h++) {
    (flow as any)._setHooks({
      wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
        wrapCalls.value++;
        await next();
      },
    });
  }

  // Build 10-step chain
  flow.startWith(
    (s) => {
      s.n++;
    },
    { label: "s0" },
  );
  for (let i = 1; i < STEPS; i++) {
    flow.then(
      (s) => {
        s.n++;
      },
      { label: `s${i}` },
    );
  }

  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) {
    await flow.run({ n: 0 });
  }
  const elapsed = performance.now() - t0;

  hdr(
    `2. Deep hook chain — ${HOOK_DEPTH} wrapStep hooks × ${total_steps.toLocaleString()} step calls`,
  );
  stat("Total time", `${elapsed.toFixed(1)} ms`);
  stat("Per step call", µs(elapsed, total_steps));
  stat("Per run", µs(elapsed, RUNS));
  stat("wrapStep invocations", wrapCalls.value.toLocaleString());
  stat("Expected wrap calls", (HOOK_DEPTH * total_steps).toLocaleString());
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Parallel fan-out (100 fns) with reducer — 3 000 runs
//    Stresses Promise.all at scale + draft-clone + reducer merge.
// ─────────────────────────────────────────────────────────────────────────────

async function demoParallelFanOut() {
  const FNS = 100;
  const RUNS = 3_000;

  interface S {
    total: number;
  }

  // Each fn adds its 1-based index to the draft's scalar total.
  // With reducer, each fn gets its own shallow draft {total:0}, so totals
  // accumulate independently and the reducer sums them: 1+2+…+100 = 5050.
  const fns = Array.from({ length: FNS }, (_, i) => (s: S) => {
    s.total += i + 1;
  });

  const flow = new FlowBuilder<S>().parallel(
    fns,
    { label: "fanOut100" },
    (shared, drafts) => {
      shared.total = drafts.reduce((sum, d) => sum + d.total, 0);
    },
  );

  const expectedSum = (FNS * (FNS + 1)) / 2; // 5050
  let sumCheck = 0;

  const t0 = performance.now();
  for (let r = 0; r < RUNS; r++) {
    const s: S = { total: 0 };
    await flow.run(s);
    sumCheck += s.total;
  }
  const elapsed = performance.now() - t0;

  hdr(
    `3. Parallel fan-out (${FNS} fns, reducer) × ${RUNS.toLocaleString()} runs`,
  );
  stat("Total time", `${elapsed.toFixed(1)} ms`);
  stat("Per run", µs(elapsed, RUNS));
  stat("Expected sum/run", expectedSum.toString());
  stat("Actual sum/run", (sumCheck / RUNS).toFixed(0));
  stat(
    "Reducer correctness",
    sumCheck === expectedSum * RUNS ? "✓ PASS" : "✗ FAIL",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. stream() overhead — 200-step flow via .run() vs .stream()
//    Isolates the event-queue bridge cost per step.
// ─────────────────────────────────────────────────────────────────────────────

async function demoStreamOverhead() {
  const STEPS = 200;
  const RUNS = 500;

  interface S {
    n: number;
  }

  const flow = new FlowBuilder<S>();
  flow.startWith((s) => {
    s.n++;
  });
  for (let i = 1; i < STEPS; i++)
    flow.then((s) => {
      s.n++;
    });

  // — .run() baseline —
  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) await flow.run({ n: 0 });
  const runMs = performance.now() - t0;

  // — .stream() with full drain —
  let chunkCount = 0;
  const t1 = performance.now();
  for (let i = 0; i < RUNS; i++) {
    for await (const event of flow.stream({ n: 0 })) {
      chunkCount++; // consume every event
      void event;
    }
  }
  const streamMs = performance.now() - t1;

  const TOTAL_STEPS = STEPS * RUNS;
  hdr(`4. stream() overhead — ${STEPS}-step flow × ${RUNS} runs`);
  stat(".run() total", `${runMs.toFixed(1)} ms`);
  stat(".run() per step", µs(runMs, TOTAL_STEPS));
  stat(".stream() total", `${streamMs.toFixed(1)} ms`);
  stat(".stream() per step", µs(streamMs, TOTAL_STEPS));
  stat("Stream overhead factor", `${(streamMs / runMs).toFixed(2)}×`);
  stat("Events consumed", chunkCount.toLocaleString());
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Fragment composition — flow built from 20 spliced fragments, 20k runs
//    Each fragment contributes 5 steps (100 steps total per run).
// ─────────────────────────────────────────────────────────────────────────────

async function demoFragmentComposition() {
  const FRAG_COUNT = 20;
  const STEPS_PER_FRAG = 5;
  const RUNS = 20_000;

  interface S {
    acc: number;
  }

  // Build 20 fragments of 5 steps each
  const frags = Array.from({ length: FRAG_COUNT }, (_, fi) => {
    const frag = fragment<S>();
    frag.startWith((s) => {
      s.acc += fi;
    });
    for (let i = 1; i < STEPS_PER_FRAG; i++) {
      frag.then((s) => {
        s.acc ^= (fi * 13 + i) & 0xff;
      });
    }
    return frag;
  });

  // Splice all fragments into one flow
  const flow = new FlowBuilder<S>();
  flow.startWith((s) => {
    s.acc = 0;
  });
  for (const frag of frags) flow.add(frag);
  flow.then((s) => {
    s.acc = s.acc >>> 0;
  }); // ensure uint32

  const t0 = performance.now();
  let finalAcc = 0;
  for (let i = 0; i < RUNS; i++) {
    const s: S = { acc: 0 };
    await flow.run(s);
    finalAcc ^= s.acc;
  }
  const elapsed = performance.now() - t0;

  const totalSteps = (FRAG_COUNT * STEPS_PER_FRAG + 2) * RUNS;

  hdr(
    `5. Fragment composition — ${FRAG_COUNT} frags × ${STEPS_PER_FRAG} steps = ${FRAG_COUNT * STEPS_PER_FRAG + 2} steps/run, ${RUNS.toLocaleString()} runs`,
  );
  stat("Total time", `${elapsed.toFixed(1)} ms`);
  stat("Per run", µs(elapsed, RUNS));
  stat("Per step call", µs(elapsed, totalSteps));
  stat(
    "XOR fingerprint",
    `0x${(finalAcc >>> 0).toString(16).padStart(8, "0")}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Everything at once
//    batch(3k items) → each item:
//      parallel(8) → loop up to 5x (quality refinement) → branch →
//      anchor/goto (up to 3 retries within item) + labels on all steps
//      + 6 active hooks (beforeFlow, beforeStep, wrapStep×2, afterStep, afterFlow)
// ─────────────────────────────────────────────────────────────────────────────

interface KitchenSinkState {
  items: number[];
  output: number[];
  __batchItem?: number;
  quality: number;
  loopCount: number;
  retryCount: number;
}

async function demoKitchenSink() {
  const N = 3_000;

  const hookFires = {
    beforeFlow: 0,
    beforeStep: 0,
    wrapStep: 0,
    wrapStepB: 0,
    afterStep: 0,
    afterFlow: 0,
  };

  const flow = new FlowBuilder<KitchenSinkState>();

  // Hook set A — timing / counting
  (flow as any)._setHooks({
    beforeFlow: () => {
      hookFires.beforeFlow++;
    },
    beforeStep: () => {
      hookFires.beforeStep++;
    },
    wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
      hookFires.wrapStep++;
      await next();
    },
    afterStep: () => {
      hookFires.afterStep++;
    },
    afterFlow: () => {
      hookFires.afterFlow++;
    },
  });

  // Hook set B — second independent wrapStep layer
  (flow as any)._setHooks({
    wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
      hookFires.wrapStepB++;
      await next();
    },
  });

  flow
    .then(
      (s) => {
        s.output = [];
      },
      { label: "init" },
    )
    .batch(
      (s) => s.items,
      (b) =>
        b
          .startWith(
            (s) => {
              s.quality = (s.__batchItem! % 100) + 1;
              s.loopCount = 0;
              s.retryCount = 0;
            },
            { label: "batchInit", retries: 1 },
          )
          .parallel(
            [
              (s) => {
                s.quality += Math.imul(s.quality, 0x9e3779b9) >>> 28;
              },
              (s) => {
                s.quality = (s.quality * 1_000_003) >>> 0;
              },
              (s) => {
                s.quality ^= s.quality >>> 4;
              },
              (s) => {
                s.quality = ((s.quality >>> 0) % 97) + 1;
              },
              (s) => {
                s.quality += s.__batchItem! & 0xf;
              },
              (s) => {
                s.quality = Math.min(100, s.quality);
              },
              (s) => {
                s.quality = Math.max(1, s.quality);
              },
              (s) => {
                s.quality = (s.quality + s.__batchItem!) % 100 || 1;
              },
            ],
            { label: "qualityHash" },
          )
          .anchor("refineLoop")
          .then(
            (s) => {
              s.loopCount++;
              // Simulate quality refinement — iterate up to 5 times
              if (s.quality < 50 && s.loopCount < 5) {
                s.quality = Math.min(100, s.quality + 15);
                return "#refineLoop";
              }
            },
            { label: "refine", retries: 2 },
          )
          .branch(
            (s) => {
              if (s.quality >= 75) return "high";
              if (s.quality >= 40) return "mid";
              return "low";
            },
            {
              high: (s) => {
                s.output.push(s.quality * 3);
              },
              mid: (s) => {
                s.output.push(s.quality * 2);
              },
              low: (s) => {
                s.output.push(s.quality);
              },
            },
            { label: "classify", retries: 1 },
          ),
      { key: "__batchItem", label: "mainBatch" },
    )
    .then(
      (s) => {
        // Final reduce — verify all items produced output
        s.output.sort((a, b) => a - b);
      },
      { label: "finalReduce" },
    );

  const shared: KitchenSinkState = {
    items: Array.from({ length: N }, (_, i) => i),
    output: [],
    quality: 0,
    loopCount: 0,
    retryCount: 0,
  };

  const t0 = performance.now();
  await flow.run(shared);
  const elapsed = performance.now() - t0;

  hdr(
    `6. Everything at once — batch(${N.toLocaleString()}) × parallel(8) × anchor/goto + 6 hooks`,
  );
  stat("Total time", `${elapsed.toFixed(1)} ms`);
  stat("Per item", µs(elapsed, N));
  stat("Output entries", shared.output.length.toLocaleString());
  stat(
    "Output min/max",
    `${shared.output[0]} / ${shared.output[shared.output.length - 1]}`,
  );
  stat("(hooks fire for outer steps only)", "");
  stat("beforeFlow fires", hookFires.beforeFlow.toLocaleString());
  stat(
    "beforeStep fires",
    `${hookFires.beforeStep}  (init + batch + finalReduce)`,
  );
  stat("wrapStep fires (A)", hookFires.wrapStep.toLocaleString());
  stat("wrapStep fires (B)", hookFires.wrapStepB.toLocaleString());
  stat("afterStep fires", hookFires.afterStep.toLocaleString());
  stat("afterFlow fires", hookFires.afterFlow.toLocaleString());
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Checkpoint plugins
//    a) withCheckpoint overhead  — 50-step flow × 2k runs, in-memory store
//    b) withVersionedCheckpoint  — diff correctness: only changed keys in diff
//    c) resumeFrom correctness   — steps before checkpoint index must not fire
// ─────────────────────────────────────────────────────────────────────────────

async function demoCheckpoint() {
  // ── 7a: withCheckpoint overhead ──────────────────────────────────────────
  const STEPS = 50;
  const RUNS = 2_000;

  interface S {
    n: number;
    tag: string;
  }

  const buildFlow = () => {
    const f = new FlowBuilder<S>();
    f.startWith(
      (s) => {
        s.n++;
        s.tag = "s0";
      },
      { label: "s0" },
    );
    for (let i = 1; i < STEPS; i++) {
      f.then(
        (s) => {
          s.n++;
          s.tag = `s${i}`;
        },
        { label: `s${i}` },
      );
    }
    return f;
  };

  // Baseline — no checkpoint
  const plainFlow = buildFlow();
  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) await plainFlow.run({ n: 0, tag: "" });
  const plainMs = performance.now() - t0;

  // withCheckpoint — in-memory store
  const saves: Array<{ stepIndex: number; n: number }> = [];
  const cpFlow = buildFlow().withCheckpoint({
    save: (stepIndex, shared: S) => {
      saves.push({ stepIndex, n: shared.n });
    },
  });
  const t1 = performance.now();
  for (let i = 0; i < RUNS; i++) await cpFlow.run({ n: 0, tag: "" });
  const cpMs = performance.now() - t1;

  const savesPerRun = saves.length / RUNS;
  // After step `stepIndex` (0-based), n === stepIndex + 1
  const correctSaves = saves.every((e) => e.n === e.stepIndex + 1);

  hdr(
    `7a. withCheckpoint overhead — ${STEPS}-step flow × ${RUNS.toLocaleString()} runs`,
  );
  stat("Baseline (.run) total", `${plainMs.toFixed(1)} ms`);
  stat("Checkpoint (.run) total", `${cpMs.toFixed(1)} ms`);
  stat("Overhead factor", `${(cpMs / plainMs).toFixed(2)}×`);
  stat("Saves per run", savesPerRun.toFixed(0));
  stat("Save data correctness", correctSaves ? "✓ PASS" : "✗ FAIL");

  // ── 7b: withVersionedCheckpoint — diff correctness ────────────────────────
  const VSTEPS = 20;

  interface VS {
    counter: number;
    evens: number;
    odds: number;
    last: string;
  }

  const vEntries: Array<{ stepIndex: number; diff: Partial<VS> }> = [];

  const vFlow = new FlowBuilder<VS>().withVersionedCheckpoint({
    save: (entry) => {
      vEntries.push({
        stepIndex: entry.stepIndex,
        diff: entry.diff as Partial<VS>,
      });
    },
    resolve: async () => ({
      stepIndex: 0,
      snapshot: { counter: 0, evens: 0, odds: 0, last: "" },
    }),
  });

  vFlow.startWith((s) => {
    s.counter++;
    s.last = "start";
  });
  for (let i = 1; i < VSTEPS; i++) {
    vFlow.then((s) => {
      s.counter++;
      if (s.counter % 2 === 0) s.evens++;
      else s.odds++;
      s.last = `step${i}`;
    });
  }

  const vShared: VS = { counter: 0, evens: 0, odds: 0, last: "" };
  const tv0 = performance.now();
  await vFlow.run(vShared);
  const vMs = performance.now() - tv0;

  // Each diff must not contain both evens and odds changing simultaneously
  const diffOnlyChanged = vEntries.every((e) => {
    const keys = Object.keys(e.diff) as (keyof VS)[];
    return !(keys.includes("evens") && keys.includes("odds"));
  });

  hdr(`7b. withVersionedCheckpoint — diff correctness, ${VSTEPS}-step flow`);
  stat("Run time", `${vMs.toFixed(2)} ms`);
  stat("Versioned entries saved", vEntries.length.toLocaleString());
  stat("Final counter", vShared.counter.toString());
  stat("Final evens / odds", `${vShared.evens} / ${vShared.odds}`);
  stat("Diff never has both evens+odds", diffOnlyChanged ? "✓ PASS" : "✗ FAIL");

  // ── 7c: resumeFrom — skipped-step correctness ─────────────────────────────
  const RESUME_STEPS = 20;
  const RESUME_AT = 9; // steps 0-9 are skipped; steps 10-19 must fire

  interface RS {
    fired: number[];
  }

  const resumeStore = {
    save: (_entry: unknown) => {},
    resolve: async (_v: string) => ({
      stepIndex: RESUME_AT,
      snapshot: { fired: [] as number[] },
    }),
  };

  const rFlow = new FlowBuilder<RS>().resumeFrom("v1", resumeStore);
  rFlow.startWith((s) => {
    s.fired.push(0);
  });
  for (let i = 1; i < RESUME_STEPS; i++) {
    rFlow.then((s) => {
      s.fired.push(i);
    });
  }

  const rShared: RS = { fired: [] };
  await rFlow.run(rShared);

  const allSkipped = rShared.fired.every((i) => i > RESUME_AT);
  const allPresent = Array.from(
    { length: RESUME_STEPS - RESUME_AT - 1 },
    (_, i) => RESUME_AT + 1 + i,
  ).every((i) => rShared.fired.includes(i));

  hdr(
    `7c. resumeFrom — ${RESUME_STEPS}-step flow, resume after step ${RESUME_AT}`,
  );
  stat("Steps fired", rShared.fired.join(", "));
  stat("Steps 0–9 skipped", allSkipped ? "✓ PASS" : "✗ FAIL");
  stat("Steps 10–19 all present", allPresent ? "✓ PASS" : "✗ FAIL");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("Flowneer heavy stress test v2");
console.log("─".repeat(72));

const wallStart = performance.now();

await demoNestedBatch();
await demoDeepHookChain();
await demoParallelFanOut();
await demoStreamOverhead();
await demoFragmentComposition();
await demoKitchenSink();
await demoCheckpoint();

const wallTotal = performance.now() - wallStart;
console.log(`\n${"─".repeat(72)}`);
console.log(`  Total wall time: ${(wallTotal / 1000).toFixed(2)} s`);
console.log("─".repeat(72));
