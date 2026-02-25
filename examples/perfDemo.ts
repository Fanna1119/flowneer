// ---------------------------------------------------------------------------
// Flowneer — Performance improvements demo
// ---------------------------------------------------------------------------
// Exercises the four optimisations shipped in v0.4.0:
//
//   1. Hook array caching   — hooks built once, reused across every step
//   2. _retry(1) fast path  — default retries=1 bypasses while/try/catch
//   3. Anchor scan skip     — _execute skips label map when no anchors present
//   4. Timeout timer cleanup — clearTimeout called on fn resolve (no leaks)
//
// Each section runs a tight loop and prints wall-time so you can observe the
// flat cost per iteration regardless of dataset size.
//
// Run with:  bun run examples/perfDemo.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";

// ── Tiny inline plugin that registers all hook types ─────────────────────────
// This maximises the caching benefit: without caching every step would
// allocate 7 × 2 arrays to filter each hook type out of _hooksList.

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    withMetrics(onStep: (label: string, ms: number) => void): this;
  }
}

const metricsPlugin: FlowneerPlugin = {
  withMetrics(
    this: FlowBuilder<any, any>,
    onStep: (label: string, ms: number) => void,
  ) {
    const starts = new Map<number, number>();
    (this as any)._setHooks({
      beforeFlow: () => {},
      beforeStep: (meta: StepMeta) => starts.set(meta.index, performance.now()),
      wrapStep: async (_meta: StepMeta, next: () => Promise<void>) => {
        await next();
      },
      afterStep: (meta: StepMeta) => {
        const t = starts.get(meta.index);
        if (t !== undefined)
          onStep(`step-${meta.index}`, performance.now() - t);
      },
      wrapParallelFn: async (
        _meta: StepMeta,
        _i: number,
        next: () => Promise<void>,
      ) => {
        await next();
      },
      onError: () => {},
      afterFlow: () => {},
    });
    return this;
  },
};
FlowBuilder.use(metricsPlugin);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hook caching — large batch with all hook types registered
//    Without caching: 7 × 2 array allocs per step × N items × M steps
//    With caching:    one allocation total, reused for every iteration
// ─────────────────────────────────────────────────────────────────────────────

interface BatchState {
  items: number[];
  results: number[];
  current?: number;
}

async function demoBatchWithHooks() {
  const N = 50_000;
  const stepCallCount = { value: 0 };

  const flow = new FlowBuilder<BatchState>()
    .withMetrics(() => {}) // registers all 7 hook types
    .batch(
      (s) => s.items,
      (b) =>
        b.startWith((s) => {
          stepCallCount.value++;
          s.results.push(s.current! * 2);
        }),
      { key: "current" },
    );

  const shared: BatchState = {
    items: Array.from({ length: N }, (_, i) => i),
    results: [],
  };

  const t0 = performance.now();
  await flow.run(shared);
  const elapsed = performance.now() - t0;

  console.log(
    `\n── 1. Hook caching — batch over ${N.toLocaleString()} items ──`,
  );
  console.log(`   Step calls : ${stepCallCount.value.toLocaleString()}`);
  console.log(`   Total time : ${elapsed.toFixed(1)} ms`);
  console.log(`   Per item   : ${((elapsed / N) * 1000).toFixed(2)} µs`);
  console.log(`   Hook arrays: built once, reused ${N.toLocaleString()} times`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. _retry fast path — default retries=1 (no retry) takes a direct return
//    path instead of entering the while/try/catch loop
// ─────────────────────────────────────────────────────────────────────────────

async function demoRetryFastPath() {
  const ITERATIONS = 100_000;
  interface S {
    n: number;
  }

  // All steps use the default retries=1 — exercises the fast path exclusively
  const flow = new FlowBuilder<S>()
    .startWith((s) => {
      s.n++;
    }) // retries: 1 (default)
    .then((s) => {
      s.n++;
    }) // retries: 1 (default)
    .then((s) => {
      s.n++;
    }); // retries: 1 (default)

  let totalSteps = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const s: S = { n: 0 };
    await flow.run(s);
    totalSteps += s.n;
  }

  console.log(
    `\n── 2. _retry fast path — ${ITERATIONS.toLocaleString()} runs × 3 steps ──`,
  );
  console.log(`   Total step invocations : ${totalSteps.toLocaleString()}`);
  console.log(`   Each used retries=1    → direct return, no loop overhead`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Anchor scan skip — flow with NO anchors skips the labels map entirely
//    Compare against a flow that has anchors to see the scan is ~free
// ─────────────────────────────────────────────────────────────────────────────

async function demoAnchorScanSkip() {
  const RUNS = 50_000;
  interface S {
    n: number;
  }

  // No anchors — scan is skipped entirely
  const flowNoAnchors = new FlowBuilder<S>()
    .startWith((s) => {
      s.n++;
    })
    .then((s) => {
      s.n++;
    })
    .then((s) => {
      s.n++;
    });

  // With anchors — scan runs, labels map is built
  const flowWithAnchors = new FlowBuilder<S>()
    .anchor("start")
    .startWith((s) => {
      s.n++;
    })
    .then((s) => {
      s.n++;
    })
    .anchor("end")
    .then((s) => {
      s.n++;
    });

  const t1 = performance.now();
  for (let i = 0; i < RUNS; i++) await flowNoAnchors.run({ n: 0 });
  const noAnchorMs = performance.now() - t1;

  const t2 = performance.now();
  for (let i = 0; i < RUNS; i++) await flowWithAnchors.run({ n: 0 });
  const withAnchorMs = performance.now() - t2;

  console.log(`\n── 3. Anchor scan skip — ${RUNS.toLocaleString()} runs ──`);
  console.log(
    `   Without anchors (scan skipped) : ${noAnchorMs.toFixed(1)} ms`,
  );
  console.log(
    `   With anchors    (scan runs)    : ${withAnchorMs.toFixed(1)} ms`,
  );
  console.log(
    `   Overhead of scan               : +${(withAnchorMs - noAnchorMs).toFixed(1)} ms`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Timeout timer cleanup — timer is cleared when fn resolves quickly
//    Without clearTimeout the timer would stay alive in the event loop
// ─────────────────────────────────────────────────────────────────────────────

async function demoTimeoutCleanup() {
  const RUNS = 1_000;
  interface S {
    n: number;
  }

  // timeoutMs set high enough that it never fires; fn resolves immediately.
  // Without clearTimeout each run would leave a 10s timer handle alive —
  // causing Bun/Node to hang at exit (or interfere with fake timers in tests).
  const flow = new FlowBuilder<S>().startWith(
    (s) => {
      s.n++;
    },
    { timeoutMs: 10_000 },
  );

  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) await flow.run({ n: 0 });
  const elapsed = performance.now() - t0;

  console.log(
    `\n── 4. Timeout timer cleanup — ${RUNS.toLocaleString()} runs with timeoutMs=10s ──`,
  );
  console.log(`   Total  : ${elapsed.toFixed(1)} ms`);
  console.log(`   Per run: ${((elapsed / RUNS) * 1000).toFixed(2)} µs`);
  console.log(
    `   All ${RUNS.toLocaleString()} setTimeout handles cleared via .finally(clearTimeout)`,
  );
  console.log(`   Process exits immediately — no dangling timers.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("Flowneer v0.4.0 — performance improvements demo\n");

await demoBatchWithHooks();
await demoRetryFastPath();
await demoAnchorScanSkip();
await demoTimeoutCleanup();

console.log("\nDone.");
