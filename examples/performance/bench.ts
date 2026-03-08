// ---------------------------------------------------------------------------
// Flowneer — microbenchmark suite
//
// Measures pure control-flow overhead for six Flowneer primitives.
// Statistical rigor courtesy of mitata (ops/sec + confidence intervals).
//
// All FlowBuilder instances and state objects are constructed BEFORE
// entering the bench callbacks — you're measuring execution, not setup.
//
// Run with: bun run bench
// ---------------------------------------------------------------------------

import { bench, group, run, summary } from "mitata";
import { FlowBuilder } from "../../Flowneer";
import type { StepMeta } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — build an N-step sequential chain
// ─────────────────────────────────────────────────────────────────────────────

interface N {
  n: number;
}

function chain(steps: number): FlowBuilder<N> {
  const flow = new FlowBuilder<N>();
  flow.startWith((s) => {
    s.n++;
  });
  for (let i = 1; i < steps; i++)
    flow.then((s) => {
      s.n++;
    });
  return flow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — Sequential .then() chain throughput
//
// Baseline: a bare async function call.
// Shows how many nanoseconds of overhead FlowBuilder adds per step.
// ─────────────────────────────────────────────────────────────────────────────

const s_seq: N = { n: 0 };
const f_1 = chain(1);
const f_5 = chain(5);
const f_10 = chain(10);

group("sequential steps", () => {
  summary(() => {
    bench("plain async fn", async () => {
      s_seq.n++;
    }).baseline();

    bench("FlowBuilder · 1 step", async () => {
      await f_1.run(s_seq);
    });

    bench("FlowBuilder · 5 steps", async () => {
      await f_5.run(s_seq);
    });

    bench("FlowBuilder · 10 steps", async () => {
      await f_10.run(s_seq);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — Batch processing
//
// A 100-item batch is the baseline; shows how cost scales to 1 000 items.
// ─────────────────────────────────────────────────────────────────────────────

interface SBatch {
  items: number[];
  __item?: number;
  total: number;
}

function buildBatchFlow(size: number) {
  const state: SBatch = {
    items: Array.from({ length: size }, (_, i) => i),
    total: 0,
  };
  const flow = new FlowBuilder<SBatch>().batch(
    (s) => s.items,
    (b) =>
      b.startWith((s) => {
        s.total += s.__item!;
      }),
    { key: "__item" },
  );
  return { flow, state };
}

const { flow: f_b100, state: s_b100 } = buildBatchFlow(100);
const { flow: f_b1k, state: s_b1k } = buildBatchFlow(1_000);

group("batch processing", () => {
  summary(() => {
    bench("batch · 100  items", async () => {
      await f_b100.run(s_b100);
    }).baseline();

    bench("batch · 1 000 items", async () => {
      await f_b1k.run(s_b1k);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 — Parallel fan-out
//
// Baseline: a native Promise.all over the same functions.
// Shows Flowneer's per-fn overhead on top of the async scheduling cost.
// ─────────────────────────────────────────────────────────────────────────────

interface SPar {
  n: number;
}

function buildParallelFlow(width: number) {
  const fns = Array.from({ length: width }, (_, i) => (s: SPar) => {
    s.n += i + 1;
  });
  const state: SPar = { n: 0 };

  const flow = new FlowBuilder<SPar>().parallel(fns);
  return { flow, fns, state };
}

const { flow: f_p4, fns: fns4, state: s_p4 } = buildParallelFlow(4);
const { flow: f_p8, fns: fns8, state: s_p8 } = buildParallelFlow(8);
const { flow: f_p16, fns: fns16, state: s_p16 } = buildParallelFlow(16);

// Plain Promise.all baselines (pure JS cost, no FlowBuilder)
async function promiseAll(fns: Array<(s: SPar) => void>, s: SPar) {
  await Promise.all(fns.map((fn) => Promise.resolve(fn(s))));
}

group("parallel fan-out", () => {
  summary(() => {
    bench("Promise.all ·  4 fns (baseline)", async () => {
      await promiseAll(fns4, s_p4);
    }).baseline();

    bench("FlowBuilder.parallel ·  4 fns", async () => {
      await f_p4.run(s_p4);
    });

    bench("FlowBuilder.parallel ·  8 fns", async () => {
      await f_p8.run(s_p8);
    });

    bench("FlowBuilder.parallel · 16 fns", async () => {
      await f_p16.run(s_p16);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4 — Branch routing
//
// Baseline: a bare if/else expression.
// Each branch gets exercised naturally as `s.n` increments across iterations.
// ─────────────────────────────────────────────────────────────────────────────

interface SBr {
  n: number;
}

const s_br: SBr = { n: 0 };

const f_br2 = new FlowBuilder<SBr>().branch(
  (s) => (s.n % 2 === 0 ? "a" : "b"),
  {
    a: (s) => {
      s.n++;
    },
    b: (s) => {
      s.n--;
    },
  },
);

const f_br4 = new FlowBuilder<SBr>().branch(
  (s) => ["a", "b", "c", "d"][s.n % 4],
  {
    a: (s) => {
      s.n++;
    },
    b: (s) => {
      s.n--;
    },
    c: (s) => {
      s.n += 2;
    },
    d: (s) => {
      s.n -= 2;
    },
  },
);

const f_br8 = new FlowBuilder<SBr>().branch(
  (s) => ["a", "b", "c", "d", "e", "f", "g", "h"][s.n % 8],
  {
    a: (s) => {
      s.n++;
    },
    b: (s) => {
      s.n--;
    },
    c: (s) => {
      s.n += 2;
    },
    d: (s) => {
      s.n -= 2;
    },
    e: (s) => {
      s.n += 3;
    },
    f: (s) => {
      s.n -= 3;
    },
    g: (s) => {
      s.n += 4;
    },
    h: (s) => {
      s.n -= 4;
    },
  },
);

group("branch routing", () => {
  summary(() => {
    bench("plain if/else · 2 paths (baseline)", async () => {
      if (s_br.n % 2 === 0) s_br.n++;
      else s_br.n--;
    }).baseline();

    bench("FlowBuilder.branch ·  2 paths", async () => {
      await f_br2.run(s_br);
    });

    bench("FlowBuilder.branch ·  4 paths", async () => {
      await f_br4.run(s_br);
    });

    bench("FlowBuilder.branch ·  8 paths", async () => {
      await f_br8.run(s_br);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5 — stream() event throughput
//
// Baseline: .run() on the same 10-step flow.
// Quantifies the async event-queue bridge cost per step.
// ─────────────────────────────────────────────────────────────────────────────

const s_st: N = { n: 0 };
const f_st = chain(10);

group("stream() overhead", () => {
  summary(() => {
    bench(".run()    · 10 steps (baseline)", async () => {
      await f_st.run(s_st);
    }).baseline();

    bench(".stream() · 10 steps (drain all events)", async () => {
      for await (const _ of f_st.stream(s_st)) {
        /* drain */
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6 — Hook overhead
//
// Same 10-step flow, progressively more hooks added.
// Baseline: zero hooks. Shows the additive cost of each hook tier.
// ─────────────────────────────────────────────────────────────────────────────

const s_h: N = { n: 0 };

const f_h_none = chain(10);

const f_h_bs = chain(10);
(f_h_bs as any)._setHooks({
  beforeStep: (_m: StepMeta) => {},
  afterStep: (_m: StepMeta) => {},
});

const f_h_wrap = chain(10);
(f_h_wrap as any)._setHooks({
  wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
    await next();
  },
});

const f_h_all = chain(10);
(f_h_all as any)._setHooks({
  beforeFlow: () => {},
  beforeStep: (_m: StepMeta) => {},
  wrapStep: async (_m: StepMeta, next: () => Promise<void>) => {
    await next();
  },
  wrapParallelFn: async (
    _m: StepMeta,
    _i: number,
    next: () => Promise<void>,
  ) => {
    await next();
  },
  afterStep: (_m: StepMeta) => {},
  onError: (_m: StepMeta, _e: unknown) => {},
  afterFlow: () => {},
});

group("hook overhead · 10 steps", () => {
  summary(() => {
    bench("no hooks (baseline)", async () => {
      await f_h_none.run(s_h);
    }).baseline();

    bench("+ beforeStep / afterStep", async () => {
      await f_h_bs.run(s_h);
    });

    bench("+ wrapStep", async () => {
      await f_h_wrap.run(s_h);
    });

    bench("+ all 7 hooks", async () => {
      await f_h_all.run(s_h);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

// await run();
await run({ format: "markdown" });
