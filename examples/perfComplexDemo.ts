// ---------------------------------------------------------------------------
// Flowneer — complex perf stress test (v0.4.0+)
// Exercises: batch(20k) + inner parallel(3) + branch + loop(3x) + label/goto
//            + mixed retries(1/3) + per-step timeoutMs + full hook set
// All work is pure in-memory (state mutations only) to isolate control-flow cost
// Run with: bun run stress.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import type { FlowneerPlugin, StepMeta } from "../Flowneer";

declare module "flowneer" {
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
// 1. Heavy batch: 20 000 items → each does parallel(3) + branch + loop(3x) + goto
// ─────────────────────────────────────────────────────────────────────────────

interface StressState {
  items: number[];
  results: number[];
  __batchItem?: number;
  passes: number;
  quality: number;
}

async function demoComplexBatch() {
  const N = 20_000;
  const stepCallCount = { value: 0 };

  const flow = new FlowBuilder<StressState>()
    .withMetrics(() => {})
    .batch(
      (s) => s.items,
      (b) =>
        b
          .startWith(
            (s) => {
              stepCallCount.value++;
              s.passes = 0;
              s.quality = 0;
            },
            { retries: 1, timeoutMs: 500 },
          )
          .parallel([
            (s) => {
              s.quality += s.__batchItem! % 10;
            },
            (s) => {
              s.quality *= 1.1;
            },
            (s) => {
              s.quality = Math.floor(s.quality);
            },
          ])
          .branch(
            (s) => (s.quality % 2 === 0 ? "even" : "odd"),
            {
              even: (s) => {
                s.results.push(s.quality * 2);
              },
              odd: (s) => {
                s.results.push(s.quality * 3);
              },
            },
            { retries: 1 },
          )
          .anchor("refine")
          // Refinement loop via goto — anchor and return "#refine" must be
          // at the same FlowBuilder level. A loop() body is a sub-FlowBuilder
          // and cannot see anchors defined in its parent.
          .then(
            (s) => {
              if (s.passes < 3) {
                s.passes++;
                s.quality = Math.max(0, s.quality - 5);
                if (s.quality < 50 && s.passes < 3) return "#refine";
              }
            },
            { retries: 3, timeoutMs: 1000 },
          ),
    );

  const shared: StressState = {
    items: Array.from({ length: N }, (_, i) => i),
    results: [],
    passes: 0,
    quality: 0,
  };

  const t0 = performance.now();
  await flow.run(shared);
  const elapsed = performance.now() - t0;

  console.log(
    `\n── 1. Complex batch — 20k items with parallel+branch+loop+goto ──`,
  );
  console.log(`   Step calls     : ${stepCallCount.value.toLocaleString()}`);
  console.log(`   Total time     : ${elapsed.toFixed(1)} ms`);
  console.log(`   Per item       : ${((elapsed / N) * 1000).toFixed(2)} µs`);
  console.log(`   Results length : ${shared.results.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Label/goto stress — 10k runs of 50-step loop via goto
// ─────────────────────────────────────────────────────────────────────────────

async function demoGotoHeavy() {
  const RUNS = 10_000;
  interface S {
    counter: number;
  }

  const flow = new FlowBuilder<S>()
    .anchor("loop")
    .then(
      (s) => {
        s.counter++;
      },
      { retries: 1 },
    )
    .then(
      (s) => {
        if (s.counter < 50) return "#loop";
      },
      { retries: 3 },
    );

  let totalCounter = 0;
  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) {
    const s: S = { counter: 0 };
    await flow.run(s);
    totalCounter += s.counter;
  }
  const elapsed = performance.now() - t0;

  console.log(
    `\n── 2. Label/goto stress — ${RUNS.toLocaleString()} runs × 50 steps ──`,
  );
  console.log(`   Total increments : ${totalCounter.toLocaleString()}`);
  console.log(`   Total time       : ${elapsed.toFixed(1)} ms`);
  console.log(
    `   Per run          : ${((elapsed / RUNS) * 1000).toFixed(2)} µs`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Top-level parallel(20) with reducer + timeout
// ─────────────────────────────────────────────────────────────────────────────

async function demoParallelHeavy() {
  const RUNS = 5_000;
  interface S {
    total: number;
  }

  const flow = new FlowBuilder<S>().parallel(
    Array.from({ length: 20 }, (_, i) => (s: S) => {
      s.total += i + 1;
    }),
    { timeoutMs: 2000 },
    (original, drafts) => {
      original.total = drafts.reduce((sum, d) => sum + d.total, 0);
    },
  );

  let totalSum = 0;
  const t0 = performance.now();
  for (let i = 0; i < RUNS; i++) {
    const s: S = { total: 0 };
    await flow.run(s);
    totalSum += s.total;
  }
  const elapsed = performance.now() - t0;

  console.log(
    `\n── 3. Top-level parallel(20) × ${RUNS.toLocaleString()} runs ──`,
  );
  console.log(`   Expected sum per run : 210`);
  console.log(`   Total summed         : ${totalSum}`);
  console.log(`   Total time           : ${elapsed.toFixed(1)} ms`);
  console.log(
    `   Per run              : ${((elapsed / RUNS) * 1000).toFixed(2)} µs`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mixed retries + timeout batch (10k items, 30% retry=3)
// ─────────────────────────────────────────────────────────────────────────────

async function demoRetryTimeoutMix() {
  const N = 10_000;
  const stepCallCount = { value: 0 };

  const flow = new FlowBuilder<{
    items: number[];
    results: number[];
    __batchItem?: number;
  }>()
    .withMetrics(() => {})
    .batch(
      (s) => s.items,
      (b) =>
        b.startWith(
          (s) => {
            stepCallCount.value++;
            const item = s.__batchItem!;
            s.results.push(item * 2);
          },
          {
            retries: (s) => (s.__batchItem! % 3 === 0 ? 3 : 1),
            timeoutMs: 500,
          },
        ),
    );

  const shared = { items: Array.from({ length: N }, (_, i) => i), results: [] };

  const t0 = performance.now();
  await flow.run(shared);
  const elapsed = performance.now() - t0;

  console.log(`\n── 4. Mixed retry/timeout batch — 10k items ──`);
  console.log(`   Step calls : ${stepCallCount.value.toLocaleString()}`);
  console.log(`   Total time : ${elapsed.toFixed(1)} ms`);
  console.log(`   Per item   : ${((elapsed / N) * 1000).toFixed(2)} µs`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("Flowneer complex perf stress test\n");

await demoComplexBatch();
await demoGotoHeavy();
await demoParallelHeavy();
await demoRetryTimeoutMix();

console.log("\nDone.");
