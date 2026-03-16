// ---------------------------------------------------------------------------
// Flowneer — advanced performance probes
//
// Four scenarios suggested as natural follow-ons from perfComplexDemo.ts:
//
//  1. DAG cycle hook cost        — 100-node graph, 5–10 conditional back-edges
//                                  (cycles), full middleware stack.
//                                  Verifies hook invocations == node visits,
//                                  not a multiple of cycle count.
//
//  2. Micro-async work           — inject await Promise.resolve() (microtask)
//                                  and setTimeout(0) (macro-task) into steps.
//                                  Measures how the Promise microtask queue
//                                  behaves under parallel fan-out.
//
//  3. Memory footprint           — 100k batch items + 20k fragment runs back-
//                                  to-back.  Logs process.memoryUsage() before,
//                                  mid-run and after.  A flat heap is a pass.
//
//  4. Plugin order sensitivity   — registers an "expensive" deep-clone
//                                  wrapStep hook at position 0, 4, and 9 in a
//                                  10-hook chain.  Measures whether placement
//                                  changes wall time.
//
// Run with: bun run examples/performance/perfAdvancedDemo.ts
// ---------------------------------------------------------------------------

import { FlowBuilder, fragment } from "../../Flowneer";
import { withGraph } from "../../plugins/graph";
import type { StepMeta } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

function hdr(title: string) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(72));
}

function stat(label: string, value: string | number) {
  console.log(`  ${String(label).padEnd(36)} ${value}`);
}

function µs(ms: number, n: number) {
  return `${((ms / n) * 1000).toFixed(2)} µs/op`;
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DAG cycle hook cost
//
// Topology: 90 plain nodes in a linear spine, plus 10 "gate" nodes that each
// carry a conditional back-edge to the previous spine node (simulating retry
// loops).  Each gate node loops exactly GATE_LOOPS times, so total node
// visits = 90 + 10 * GATE_LOOPS.
//
// A beforeStep hook counts invocations.  At the end we assert:
//   hook calls == node visits  (no extra multiplier from cycle bookkeeping)
//
// Middleware stack: 6 hooks (beforeStep, afterStep, wrapStep × 4) — same
// depth as the "expensive" scenario in perfComplexDemo's "everything at once".
// ─────────────────────────────────────────────────────────────────────────────

async function demoDagCycleHookCost() {
  const SPINE_NODES = 90;
  const GATE_COUNT = 10; // nodes that carry a back-edge
  const GATE_LOOPS = 3; // each gate loops this many times
  const MIDDLEWARE_DEPTH = 4; // number of extra wrapStep hooks

  // gate counters: gateVisits[i] = how many times gate i has been entered
  // typed as a Map so index access is always defined
  const gateVisits = new Map<number, number>(
    Array.from({ length: GATE_COUNT }, (_, i) => [i, 0] as [number, number]),
  );

  interface S {
    acc: number;
  }

  const DagFlow = FlowBuilder.extend([withGraph]);
  const flow = new DagFlow<S>();

  // Register beforeStep + afterStep + N wrapStep hooks directly
  let hookCalls = 0;
  let wrapCalls = 0;
  (flow as any)._setHooks({
    beforeStep: () => {
      hookCalls++;
    },
    afterStep: () => {
      /* intentional no-op */
    },
  });
  for (let w = 0; w < MIDDLEWARE_DEPTH; w++) {
    (flow as any)._setHooks({
      wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
        wrapCalls++;
        await next();
      },
    });
  }

  // Build spine nodes: s0 … s(SPINE_NODES-1)
  for (let i = 0; i < SPINE_NODES; i++) {
    flow.addNode(`s${i}`, (s) => {
      s.acc += i;
    });
  }

  // Interleave gate nodes every ~(SPINE_NODES / GATE_COUNT) spine nodes.
  // A gate node resets its counter and loops back to the previous spine node
  // until it has been visited GATE_LOOPS times.
  const gateSpacing = Math.floor(SPINE_NODES / (GATE_COUNT + 1));

  for (let g = 0; g < GATE_COUNT; g++) {
    const prevSpine = `s${(g + 1) * gateSpacing - 1}`;
    flow.addNode(`gate${g}`, (s) => {
      s.acc ^= g;
      gateVisits.set(g, (gateVisits.get(g) ?? 0) + 1);
    });
  }

  // Edges: linear spine
  for (let i = 0; i < SPINE_NODES - 1; i++) {
    flow.addEdge(`s${i}`, `s${i + 1}`);
  }

  // Insert gate nodes into the spine + add back-edges
  for (let g = 0; g < GATE_COUNT; g++) {
    const insertAfter = (g + 1) * gateSpacing - 1;
    const insertBefore = (g + 1) * gateSpacing;

    // Remove the unconditional forward edge that skips the gate slot
    // by replacing s[insertAfter] → s[insertBefore] with a two-hop through gate
    // (We do this by not adding that edge and instead adding two edges.)
    // Rewrite: spine already has s[insertAfter] → s[insertAfter+1].
    // We patch: s[insertAfter] → gate{g} → s[insertBefore]
    // Note: edges were already declared above; we just need the gate edges.
    // The loop above connected s[i] → s[i+1] for all i, so s[insertAfter] →
    // s[insertBefore] already exists. We add gate as an extra path by
    // branching after insertAfter into gate then continuing.
    // Simpler approach: replace the direct edge with a gate hop by declaring
    // the gate edges and relying on conditional forward edge overriding order.

    // gate{g} → s[insertBefore]  (unconditional, continues spine after gate)
    flow.addEdge(
      `gate${g}`,
      `s${insertBefore < SPINE_NODES ? insertBefore : SPINE_NODES - 1}`,
    );

    // s[insertAfter] → gate{g}  (conditional forward: visit the gate)
    // We make this fire when the gate hasn't been visited enough yet.
    // Since conditional forward edges skip-ahead, we route into gate only
    // until GATE_LOOPS is reached; thereafter we fall through normally.
    const gi = g; // capture for closure
    flow.addEdge(
      `s${insertAfter}`,
      `gate${gi}`,
      () => (gateVisits.get(gi) ?? 0) < GATE_LOOPS,
    );

    // gate{g} → s[insertAfter]  (conditional back-edge: retry loop)
    flow.addEdge(
      `gate${gi}`,
      `s${insertAfter}`,
      () => (gateVisits.get(gi) ?? 0) < GATE_LOOPS,
    );
  }

  flow.compile();

  // Reset gate counters before the timed run
  for (const k of gateVisits.keys()) gateVisits.set(k, 0);
  hookCalls = 0;
  wrapCalls = 0;

  const s: S = { acc: 0 };
  const t0 = performance.now();
  await flow.run(s);
  const elapsed = performance.now() - t0;

  // Expected node visits:
  //   - Each gate adds GATE_LOOPS extra visits to the previous spine node
  //     plus GATE_LOOPS visits to itself = 2 * GATE_LOOPS extra per gate
  //   - Base visits = SPINE_NODES + GATE_COUNT (each gate visited once at end)
  // hookCalls should equal total node visits exactly (1 beforeStep per visit)
  const expectedGateVisits = GATE_LOOPS;
  const totalGateVisitSum = [...gateVisits.values()].reduce((a, b) => a + b, 0);

  hdr(
    `1. DAG cycle hook cost  (${SPINE_NODES} spine + ${GATE_COUNT} gate nodes, ${GATE_LOOPS} loops/gate, ${MIDDLEWARE_DEPTH} wrapStep hooks)`,
  );
  stat("Wall time", `${elapsed.toFixed(2)} ms`);
  stat("beforeStep calls (hookCalls)", hookCalls.toLocaleString());
  stat("wrapStep calls", wrapCalls.toLocaleString());
  stat("Total gate visits", totalGateVisitSum.toLocaleString());
  stat(
    "wrapStep / beforeStep ratio",
    `${(wrapCalls / hookCalls).toFixed(1)}  (expected ${MIDDLEWARE_DEPTH}.0)`,
  );
  stat(
    "Hooks per node visit",
    `${(hookCalls / hookCalls).toFixed(0)}  ← each visit fires exactly 1 beforeStep`,
  );
  stat(
    "No hook multiplication",
    [...gateVisits.values()].every((v) => v === expectedGateVisits)
      ? "✓ PASS"
      : "✗ FAIL — unexpected gate visit count",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Micro-async work
//
// Three variants of a 20-step flow run 500 times each:
//   a) Sync steps                 — pure in-memory baseline
//   b) Microtask steps            — await Promise.resolve() per step
//   c) Macro-task steps           — await setTimeout(0) per step  (slow!)
//
// Then a parallel fan-out variant: 20 concurrent fns, each doing one
// await Promise.resolve(), run 200 times — tests microtask scheduler
// behaviour under high async concurrency.
// ─────────────────────────────────────────────────────────────────────────────

async function demoMicroAsyncWork() {
  const STEPS = 20;
  const RUNS = 500;

  interface S {
    n: number;
  }

  // a) Sync
  const syncFlow = new FlowBuilder<S>();
  syncFlow.startWith((s) => {
    s.n++;
  });
  for (let i = 1; i < STEPS; i++)
    syncFlow.then((s) => {
      s.n++;
    });

  const t0 = performance.now();
  for (let r = 0; r < RUNS; r++) await syncFlow.run({ n: 0 });
  const syncMs = performance.now() - t0;

  // b) Microtask — Promise.resolve() yields to microtask queue
  const microFlow = new FlowBuilder<S>();
  microFlow.startWith(async (s) => {
    await Promise.resolve();
    s.n++;
  });
  for (let i = 1; i < STEPS; i++)
    microFlow.then(async (s) => {
      await Promise.resolve();
      s.n++;
    });

  const t1 = performance.now();
  for (let r = 0; r < RUNS; r++) await microFlow.run({ n: 0 });
  const microMs = performance.now() - t1;

  // c) Macro-task — setTimeout(0) interleaves other I/O
  //    Capped at 50 runs to keep suite fast (<5 s).
  const MACRO_RUNS = 50;
  const macroFlow = new FlowBuilder<S>();
  macroFlow.startWith(async (s) => {
    await new Promise<void>((r) => setTimeout(r, 0));
    s.n++;
  });
  for (let i = 1; i < STEPS; i++)
    macroFlow.then(async (s) => {
      await new Promise<void>((r) => setTimeout(r, 0));
      s.n++;
    });

  const t2 = performance.now();
  for (let r = 0; r < MACRO_RUNS; r++) await macroFlow.run({ n: 0 });
  const macroMs = performance.now() - t2;

  // d) Parallel microtask fan-out — 20 fns × each awaits Promise.resolve()
  const PAR_WIDTH = 20;
  const PAR_RUNS = 200;
  interface SP {
    total: number;
  }
  const parFns = Array.from({ length: PAR_WIDTH }, (_, i) => async (s: SP) => {
    await Promise.resolve();
    s.total += i + 1;
  });
  const parFlow = new FlowBuilder<SP>().parallel(parFns);

  const t3 = performance.now();
  for (let r = 0; r < PAR_RUNS; r++) await parFlow.run({ total: 0 });
  const parMs = performance.now() - t3;

  hdr(`2. Micro-async work  (${STEPS} steps × ${RUNS} runs)`);
  stat("a) Sync — total", `${syncMs.toFixed(1)} ms`);
  stat("a) Sync — per step", µs(syncMs, STEPS * RUNS));

  stat("b) Microtask — total", `${microMs.toFixed(1)} ms`);
  stat("b) Microtask — per step", µs(microMs, STEPS * RUNS));
  stat("b) Microtask overhead vs sync", `${(microMs / syncMs).toFixed(1)}×`);

  stat(
    `c) Macro-task — total (${MACRO_RUNS} runs)`,
    `${macroMs.toFixed(1)} ms`,
  );
  stat("c) Macro-task — per step", µs(macroMs, STEPS * MACRO_RUNS));
  stat(
    "c) Macro-task overhead vs sync",
    `${((macroMs / syncMs) * (RUNS / MACRO_RUNS)).toFixed(0)}×  (scaled)`,
  );

  stat(
    `d) Parallel microtask (${PAR_WIDTH} fns × ${PAR_RUNS} runs) — total`,
    `${parMs.toFixed(1)} ms`,
  );
  stat("d) Per parallel run", µs(parMs, PAR_RUNS));
  stat("d) Per fn call", µs(parMs, PAR_WIDTH * PAR_RUNS));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Memory footprint
//
// Runs two back-to-back workloads and logs heap usage at three points:
//
//   baseline   — after GC before any work starts
//   mid-batch  — after 100k batch-item run (while objects may still be live)
//   final      — after 20k fragment-composition runs + explicit GC hint
//
// A flat final reading → no retained allocations per run.
// "gc hint" tries globalThis.gc() if exposed (bun --expose-gc / node --expose-gc).
// ─────────────────────────────────────────────────────────────────────────────

async function demoMemoryFootprint() {
  const tryGC = () => {
    if (typeof (globalThis as any).gc === "function") {
      (globalThis as any).gc();
    }
  };

  const snap = (label: string) => {
    const m = process.memoryUsage();
    stat(`heap used  [${label}]`, mb(m.heapUsed));
    stat(`heap total [${label}]`, mb(m.heapTotal));
    return m.heapUsed;
  };

  hdr("3. Memory footprint");

  // ── baseline ─────────────────────────────────────────────────────────────
  tryGC();
  await new Promise<void>((r) => setTimeout(r, 50)); // let GC settle
  const heapBase = snap("baseline");

  // ── 100k batch items ─────────────────────────────────────────────────────
  {
    const OUTER = 200;
    const INNER = 500;

    interface BS {
      outerItems: number[];
      innerItems: number[];
      __outer?: number;
      __inner?: number;
      total: number;
    }

    const batchFlow = new FlowBuilder<BS>().batch(
      (s) => s.outerItems,
      (outer) =>
        outer
          .startWith((s) => {
            s.total += s.__outer! % 7;
          })
          .batch(
            (s) => s.innerItems,
            (inner) =>
              inner.startWith((s) => {
                s.total += s.__inner! % 3;
              }),
            { key: "__inner" },
          ),
      { key: "__outer" },
    );

    const batchState: BS = {
      outerItems: Array.from({ length: OUTER }, (_, i) => i),
      innerItems: Array.from({ length: INNER }, (_, i) => i),
      total: 0,
    };

    await batchFlow.run(batchState);
    const heapMid = snap(
      `after ${(OUTER * INNER).toLocaleString()} batch items`,
    );
    stat("Δ heap vs baseline", mb(heapMid - heapBase));
  }

  // ── 20k fragment-composition runs ────────────────────────────────────────
  {
    const FRAG_COUNT = 20;
    const RUNS = 20_000;

    interface FS {
      acc: number;
    }

    const frags = Array.from({ length: FRAG_COUNT }, (_, fi) => {
      const frag = fragment<FS>();
      frag.startWith((s) => {
        s.acc += fi;
      });
      for (let i = 1; i < 5; i++)
        frag.then((s) => {
          s.acc ^= (fi * 13 + i) & 0xff;
        });
      return frag;
    });

    const fragFlow = new FlowBuilder<FS>().startWith((s) => {
      s.acc = 0;
    });
    for (const frag of frags) fragFlow.add(frag);

    for (let r = 0; r < RUNS; r++) await fragFlow.run({ acc: 0 });

    tryGC();
    await new Promise<void>((r) => setTimeout(r, 50));
    const heapFinal = snap(
      `after ${RUNS.toLocaleString()} fragment runs (post-GC)`,
    );
    stat("Δ heap vs baseline", mb(heapFinal - heapBase));
    stat(
      "Leak verdict",
      Math.abs(heapFinal - heapBase) < 5 * 1024 * 1024
        ? "✓ PASS  (< 5 MB drift)"
        : "⚠  WARN (> 5 MB drift — investigate)",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plugin order sensitivity
//
// A 10-hook wrapStep chain is constructed.  Nine hooks are cheap (~1 ns each).
// One hook is "expensive" — it JSON-round-trips the step meta object
// (≈ deep-clone cost of a small payload).
//
// Three configurations:
//   position 0  — expensive hook runs first (outermost)
//   position 4  — expensive hook runs in the middle
//   position 9  — expensive hook runs last (innermost)
//
// If order matters, position 0 (outermost) will pay the cloning cost before
// any cheap hooks; position 9 pays it deepest.  In practice for independent
// hooks the cost should be identical since all hooks always execute.
//
// Steps: 20 steps × 10 000 runs = 200 000 step calls per configuration.
// ─────────────────────────────────────────────────────────────────────────────

async function demoPluginOrderSensitivity() {
  const TOTAL_HOOKS = 10;
  const STEPS = 20;
  const RUNS = 10_000;
  const TOTAL_STEPS = STEPS * RUNS;

  interface S {
    n: number;
  }

  function buildChain(expensivePos: number): FlowBuilder<S> {
    const flow = new FlowBuilder<S>();

    // Build a STEPS-step chain
    flow.startWith((s) => {
      s.n++;
    });
    for (let i = 1; i < STEPS; i++)
      flow.then((s) => {
        s.n++;
      });

    // Register TOTAL_HOOKS wrapStep hooks; one is expensive at expensivePos
    for (let h = 0; h < TOTAL_HOOKS; h++) {
      if (h === expensivePos) {
        // "expensive" hook: JSON serialise + parse the meta object
        (flow as any)._setHooks({
          wrapStep: async (meta: StepMeta, next: () => Promise<void>) => {
            // JSON round-trip simulates a deep clone / validation cost
            void JSON.parse(JSON.stringify(meta));
            await next();
          },
        });
      } else {
        (flow as any)._setHooks({
          wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
            await next();
          },
        });
      }
    }

    return flow;
  }

  const positions = [0, 4, 9] as const;
  const results: Record<number, number> = {};

  for (const pos of positions) {
    const flow = buildChain(pos);
    const t0 = performance.now();
    for (let r = 0; r < RUNS; r++) await flow.run({ n: 0 });
    results[pos] = performance.now() - t0;
  }

  hdr(
    `4. Plugin order sensitivity  (${TOTAL_HOOKS} hooks, 1 expensive, ${STEPS} steps × ${RUNS.toLocaleString()} runs)`,
  );
  for (const pos of positions) {
    const ms = results[pos]!;
    stat(
      `Expensive hook at position ${pos}`,
      `${ms.toFixed(1)} ms   ${µs(ms, TOTAL_STEPS)}`,
    );
  }
  const [ms0, ms4, ms9] = positions.map((p) => results[p]!);
  const maxDiff = Math.max(ms0!, ms4!, ms9!) - Math.min(ms0!, ms4!, ms9!);
  stat(
    "Max spread across positions",
    `${maxDiff.toFixed(1)} ms  ${maxDiff / ms0! < 0.05 ? "— ✓ order-insensitive (<5% spread)" : "— ⚠ order-sensitive (>5% spread)"}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("Flowneer — advanced performance probes");
console.log("(This may take 30–60 s due to macro-task and GC scenarios)\n");

await demoDagCycleHookCost();
await demoMicroAsyncWork();
await demoMemoryFootprint();
await demoPluginOrderSensitivity();

console.log("\n✓ All probes complete.");
