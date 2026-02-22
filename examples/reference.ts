// ---------------------------------------------------------------------------
// Usage examples — imports from the local Flowneer implementation (no deps)
// ---------------------------------------------------------------------------

import { FlowBuilder, FlowError } from "../Flowneer";

// ── Example 1: Simple sequential flow ──────────────────────────────────────

interface CounterState {
  count: number;
}

await new FlowBuilder<CounterState>()
  .startWith(async (s) => {
    s.count = 0;
  })
  .then(async (s) => {
    s.count += 1;
    console.log("count:", s.count);
  })
  .then(async (s) => {
    s.count += 1;
    console.log("count:", s.count);
  })
  .run({ count: 0 });
// prints: count: 1, count: 2

// ── Example 2: Branch routing ──────────────────────────────────────────────

interface AuthState {
  role: string;
  message: string;
}

await new FlowBuilder<AuthState>()
  .startWith(async (s) => {
    s.role = "admin";
  })
  .branch((s) => s.role, {
    admin: async (s) => {
      s.message = "Welcome, admin!";
    },
    guest: async (s) => {
      s.message = "Limited access.";
    },
  })
  .then(async (s) => console.log(s.message))
  .run({ role: "", message: "" });
// prints: Welcome, admin!

// ── Example 3: Batch processing ────────────────────────────────────────────

interface SumState {
  numbers: number[];
  results: number[];
  __batchItem?: number;
}

await new FlowBuilder<SumState>()
  .startWith(async (s) => {
    s.results = [];
  })
  .batch(
    (s) => s.numbers,
    (b) =>
      b.startWith(async (s) => {
        s.results.push((s.__batchItem ?? 0) * 2);
      }),
  )
  .then(async (s) => console.log("batch results:", s.results))
  .run({ numbers: [1, 2, 3], results: [] });
// prints: batch results: [2, 4, 6]

// ── Example 4: Parallel execution ──────────────────────────────────────────

interface DataState {
  a?: string;
  b?: string;
}

await new FlowBuilder<DataState>()
  .startWith(async () => {})
  .parallel([
    async (s) => {
      s.a = "fetched A";
    },
    async (s) => {
      s.b = "fetched B";
    },
  ])
  .then(async (s) => console.log("parallel:", s.a, s.b))
  .run({});
// prints: parallel: fetched A fetched B

// ── Example 5: Loop ────────────────────────────────────────────────────────

interface TickState {
  ticks: number;
}

await new FlowBuilder<TickState>()
  .startWith(async (s) => {
    s.ticks = 0;
  })
  .loop(
    (s) => s.ticks < 3,
    (b) =>
      b.startWith(async (s) => {
        s.ticks += 1;
      }),
  )
  .then(async (s) => console.log("done, ticks =", s.ticks))
  .run({ ticks: 0 });
// prints: done, ticks = 3

// ── Example 6: parallel jsonplaceholder fetch ──────────────────────────────────────────

interface FetchState {
  posts?: any[];
  users?: any[];
}

await new FlowBuilder<FetchState>()
  .parallel([
    async (s) => {
      const res = await fetch("https://jsonplaceholder.typicode.com/posts");
      s.posts = (await res.json()) as any[];
    },
    async (s) => {
      const res = await fetch("https://jsonplaceholder.typicode.com/users");
      s.users = (await res.json()) as any[];
    },
  ])
  .then(async (s) => {
    console.log(
      "Fetched",
      s.posts?.length,
      "posts and",
      s.users?.length,
      "users",
    );
  })
  .run({});
// prints: Fetched 100 posts and 10 users

// ── Example 7: Error context ──────────────────────────────────────────────
// Shows that FlowError captures the step index and wraps the original cause.

// 7a: error in a plain step
try {
  await new FlowBuilder()
    .startWith(async () => {})
    .then(async () => {
      throw new Error("something went wrong");
    })
    .run({});
} catch (err) {
  if (err instanceof FlowError) {
    console.log("[7a] step   :", err.step); // "step 1"
    console.log("[7a] message:", err.message); // "Flow failed at step 1: something went wrong"
    console.log("[7a] cause  :", (err.cause as Error).message); // "something went wrong"
  }
}

// 7b: error inside a loop body
try {
  await new FlowBuilder<{ i: number }>()
    .startWith(async (s) => {
      s.i = 0;
    })
    .loop(
      (s) => s.i < 5,
      (b) =>
        b.startWith(async (s) => {
          s.i += 1;
          if (s.i === 2) throw new Error("exploded on tick 2");
        }),
    )
    .run({ i: 0 });
} catch (err) {
  if (err instanceof FlowError) {
    console.log("[7b] step   :", err.step); // "loop (step 1)"
    console.log("[7b] message:", err.message); // "Flow failed at loop (step 1): exploded on tick 2"
  }
}

// 7c: error inside a batch processor
try {
  await new FlowBuilder<{ items: number[]; __batchItem?: number }>()
    .batch(
      (s) => s.items,
      (b) =>
        b.startWith(async (s) => {
          if (s.__batchItem === 3) throw new Error("bad item: 3");
        }),
    )
    .run({ items: [1, 2, 3, 4] });
} catch (err) {
  if (err instanceof FlowError) {
    console.log("[7c] step   :", err.step); // "batch (step 0)"
    console.log("[7c] message:", err.message); // "Flow failed at batch (step 0): bad item: 3"
  }
}

// ── Example 8: Agent-to-agent delegation ──────────────────────────────────
// Sub-agents share the same `shared` object — each one reads and mutates it.
// Call anotherFlow.run(shared) inside a `then` to delegate.

interface ReportState {
  query: string;
  sources?: string[];
  summary?: string;
  report?: string;
}

const researchAgent = new FlowBuilder<ReportState>()
  .startWith(async (s) => {
    // Simulate fetching sources
    s.sources = [`source-A for "${s.query}"`, `source-B for "${s.query}"`];
  })
  .then(async (s) => {
    s.summary = s.sources!.join(" | ");
  });

const writeAgent = new FlowBuilder<ReportState>().startWith(async (s) => {
  s.report = `# Report\n\nQuery: ${s.query}\n\nSummary: ${s.summary}`;
});

await new FlowBuilder<ReportState>()
  .startWith(async (s) => {
    s.query = "LLM benchmarks 2025";
  })
  .then(async (s) => researchAgent.run(s)) // delegate → mutates s.sources, s.summary
  .then(async (s) => writeAgent.run(s)) // delegate → mutates s.report
  .then(async (s) => console.log(s.report))
  .run({ query: "" });

// ── Example 9: Parallel sub-agents ────────────────────────────────────────
// Independent sub-agents run concurrently via `parallel`.
// Each writes to a distinct key — avoid writing the same key from two branches.

interface AnalysisState {
  text: string;
  sentiment?: string;
  summary?: string;
  toxicity?: string;
}

const sentimentAgent = new FlowBuilder<AnalysisState>().startWith(async (s) => {
  s.sentiment = `positive (mock for: "${s.text}")`;
});

const summaryAgent = new FlowBuilder<AnalysisState>().startWith(async (s) => {
  s.summary = `summary of: "${s.text}"`;
});

const toxicityAgent = new FlowBuilder<AnalysisState>().startWith(async (s) => {
  s.toxicity = "none";
});

await new FlowBuilder<AnalysisState>()
  .startWith(async (s) => {
    s.text = "Flowneer is a great library!";
  })
  .parallel([
    (s) => sentimentAgent.run(s), // writes s.sentiment
    (s) => summaryAgent.run(s), // writes s.summary
    (s) => toxicityAgent.run(s), // writes s.toxicity
  ])
  .then(async (s) => {
    console.log("sentiment:", s.sentiment);
    console.log("summary  :", s.summary);
    console.log("toxicity :", s.toxicity);
  })
  .run({ text: "" });

console.log("\n✅ All examples passed!");
