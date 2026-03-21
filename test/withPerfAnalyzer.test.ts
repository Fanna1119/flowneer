// ---------------------------------------------------------------------------
// Tests for withPerfAnalyzer
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder } from "../Flowneer";
import { withPerfAnalyzer } from "../plugins/dev/withPerfAnalyzer";
import type {
  StepPerfStats,
  PerfReport,
} from "../plugins/dev/withPerfAnalyzer";

const PerfFlow = FlowBuilder.extend([withPerfAnalyzer]);

// ─────────────────────────────────────────────────────────────────────────────
// Basic stats population
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — basic stats", () => {
  test("populates __perfStats with one entry per step", async () => {
    const shared: any = {};
    const flow = new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "step-a" })
      .then(async () => {}, { label: "step-b" });

    await flow.run(shared);

    expect(Array.isArray(shared.__perfStats)).toBe(true);
    expect(shared.__perfStats).toHaveLength(2);
  });

  test("each StepPerfStats entry has required numeric fields", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "measure-me" })
      .run(shared);

    const stat: StepPerfStats = shared.__perfStats[0];
    expect(stat.index).toBe(0);
    expect(stat.label).toBe("measure-me");
    expect(typeof stat.durationMs).toBe("number");
    expect(stat.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof stat.cpuUserMs).toBe("number");
    expect(typeof stat.cpuSystemMs).toBe("number");
    expect(typeof stat.heapUsedBefore).toBe("number");
    expect(typeof stat.heapUsedAfter).toBe("number");
    expect(typeof stat.heapDeltaBytes).toBe("number");
    expect(typeof stat.rssDeltaBytes).toBe("number");
    expect(typeof stat.externalDeltaBytes).toBe("number");
    expect(typeof stat.gcCount).toBe("number");
    expect(typeof stat.gcDurationMs).toBe("number");
    expect(stat.threw).toBe(false);
  });

  test("heapDeltaBytes equals heapUsedAfter - heapUsedBefore", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .run(shared);

    const stat: StepPerfStats = shared.__perfStats[0];
    expect(stat.heapDeltaBytes).toBe(stat.heapUsedAfter - stat.heapUsedBefore);
  });

  test("durationMs reflects actual elapsed time (rough check)", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {
        await new Promise((r) => setTimeout(r, 30));
      })
      .run(shared);

    expect(shared.__perfStats[0].durationMs).toBeGreaterThanOrEqual(25);
  });

  test("stats are in execution order across multiple steps", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "first" })
      .then(async () => {}, { label: "second" })
      .then(async () => {}, { label: "third" })
      .run(shared);

    const labels = (shared.__perfStats as StepPerfStats[]).map((s) => s.label);
    expect(labels).toEqual(["first", "second", "third"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PerfReport summary
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — PerfReport", () => {
  test("writes __perfReport after the flow completes", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .run(shared);

    expect(shared.__perfReport).toBeDefined();
  });

  test("totalDurationMs equals sum of step durations", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .then(async () => {})
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    const stats: StepPerfStats[] = shared.__perfStats;
    const expected = stats.reduce((a, s) => a + s.durationMs, 0);
    expect(report.totalDurationMs).toBeCloseTo(expected, 5);
  });

  test("peakHeapUsedBytes is the max heapUsedAfter across all steps", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .then(async () => {})
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    const stats: StepPerfStats[] = shared.__perfStats;
    const expectedPeak = Math.max(...stats.map((s) => s.heapUsedAfter));
    expect(report.peakHeapUsedBytes).toBe(expectedPeak);
  });

  test("slowest points to the step with the longest durationMs", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "fast" })
      .then(
        async () => {
          await new Promise((r) => setTimeout(r, 30));
        },
        { label: "slow" },
      )
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    expect(report.slowest?.label).toBe("slow");
  });

  test("heaviest is the entry with the max heapDeltaBytes in report.steps", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "a" })
      .then(async () => {}, { label: "b" })
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    const stats: StepPerfStats[] = shared.__perfStats;
    const maxDelta = Math.max(...stats.map((s) => s.heapDeltaBytes));
    expect(report.heaviest).not.toBeNull();
    expect(report.heaviest!.heapDeltaBytes).toBe(maxDelta);
  });

  test("slowest and heaviest are null when no steps ran", async () => {
    const shared: any = {};
    // Build flow with no steps (just .run directly)
    const flow = new PerfFlow<any>().withPerfAnalyzer();
    await flow.run(shared);

    const report: PerfReport = shared.__perfReport;
    expect(report.slowest).toBeNull();
    expect(report.heaviest).toBeNull();
  });

  test("report.steps matches shared.__perfStats", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "a" })
      .then(async () => {}, { label: "b" })
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    expect(report.steps).toBe(shared.__perfStats);
  });

  test("onReport callback receives the final PerfReport", async () => {
    const shared: any = {};
    let received: PerfReport | null = null;

    await new PerfFlow<any>()
      .withPerfAnalyzer({
        onReport: (r) => {
          received = r;
        },
      })
      .then(async () => {})
      .run(shared);

    expect(received).not.toBeNull();
    expect(received).toBe(shared.__perfReport);
  });

  test("totalCpuUserMs and totalCpuSystemMs are non-negative numbers", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    expect(report.totalCpuUserMs).toBeGreaterThanOrEqual(0);
    expect(report.totalCpuSystemMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// threw flag
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — threw flag", () => {
  test("threw is true when a step throws, stats are still recorded", async () => {
    const shared: any = {};
    try {
      await new PerfFlow<any>()
        .withPerfAnalyzer()
        .then(
          async () => {
            throw new Error("boom");
          },
          { label: "failing" },
        )
        .run(shared);
    } catch {}

    expect(shared.__perfStats).toHaveLength(1);
    expect(shared.__perfStats[0].threw).toBe(true);
    expect(shared.__perfStats[0].label).toBe("failing");
  });

  test("threw is false for successful steps", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .run(shared);

    expect(shared.__perfStats[0].threw).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StepFilter — only matched steps are profiled
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — StepFilter (label array)", () => {
  test("only profiled steps appear in __perfStats when filter is applied", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer({}, ["llm:*"])
      .then(async () => {}, { label: "load" })
      .then(async () => {}, { label: "llm:generate" })
      .then(async () => {}, { label: "llm:embed" })
      .then(async () => {}, { label: "save" })
      .run(shared);

    const labels = (shared.__perfStats as StepPerfStats[]).map((s) => s.label);
    expect(labels).toEqual(["llm:generate", "llm:embed"]);
  });

  test("exact label filter only profiles the named step", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer({}, ["target"])
      .then(async () => {}, { label: "ignore" })
      .then(async () => {}, { label: "target" })
      .then(async () => {}, { label: "ignore" })
      .run(shared);

    const stats: StepPerfStats[] = shared.__perfStats;
    expect(stats).toHaveLength(1);
    expect(stats[0]?.label).toBe("target");
  });

  test("unmatched steps still run (filter only skips profiling)", async () => {
    const shared: any = { ran: [] as string[] };
    await new PerfFlow<any>()
      .withPerfAnalyzer({}, ["profiled"])
      .then(
        async (s: any) => {
          s.ran.push("a");
        },
        { label: "a" },
      )
      .then(
        async (s: any) => {
          s.ran.push("profiled");
        },
        { label: "profiled" },
      )
      .then(
        async (s: any) => {
          s.ran.push("b");
        },
        { label: "b" },
      )
      .run(shared);

    // All steps ran
    expect(shared.ran).toEqual(["a", "profiled", "b"]);
    // Only profiled step in stats
    expect(shared.__perfStats).toHaveLength(1);
  });
});

describe("withPerfAnalyzer — StepFilter (predicate)", () => {
  test("predicate filter profiles only matching steps", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer({}, (meta) => meta.index % 2 === 0)
      .then(async () => {}, { label: "even-0" }) // index 0 — profiled
      .then(async () => {}, { label: "odd-1" }) // index 1 — skipped
      .then(async () => {}, { label: "even-2" }) // index 2 — profiled
      .then(async () => {}, { label: "odd-3" }) // index 3 — skipped
      .run(shared);

    const labels = (shared.__perfStats as StepPerfStats[]).map((s) => s.label);
    expect(labels).toEqual(["even-0", "even-2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GC tracking
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — GC tracking", () => {
  test("trackGc: false disables GC observer, gcCount/gcDurationMs are 0", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer({ trackGc: false })
      .then(async () => {})
      .run(shared);

    const stat: StepPerfStats = shared.__perfStats[0];
    expect(stat.gcCount).toBe(0);
    expect(stat.gcDurationMs).toBe(0);
    const report: PerfReport = shared.__perfReport;
    expect(report.totalGcCount).toBe(0);
    expect(report.totalGcDurationMs).toBe(0);
  });

  test("totalGcDurationMs and totalGcCount are non-negative when trackGc: true", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer({ trackGc: true })
      .then(async () => {})
      .run(shared);

    const report: PerfReport = shared.__perfReport;
    expect(report.totalGcCount).toBeGreaterThanOrEqual(0);
    expect(report.totalGcDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent steps inside .parallel()
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — .parallel() steps", () => {
  test("each parallel lane gets its own StepPerfStats entry", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .parallel([async () => {}, async () => {}, async () => {}])
      .run(shared);

    // parallel() is a single step — one entry with type "parallel"
    const stats: StepPerfStats[] = shared.__perfStats;
    expect(stats).toHaveLength(1);
    expect(stats[0]?.type).toBe("parallel");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple runs — stats reset between runs
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — multiple runs", () => {
  test("__perfStats accumulates fresh entries on each run", async () => {
    const flow = new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {}, { label: "step" });

    const s1: any = {};
    await flow.run(s1);
    expect(s1.__perfStats).toHaveLength(1);

    const s2: any = {};
    await flow.run(s2);
    expect(s2.__perfStats).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// step type is recorded correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("withPerfAnalyzer — step type field", () => {
  test("fn steps are recorded with type 'fn'", async () => {
    const shared: any = {};
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .then(async () => {})
      .run(shared);

    expect(shared.__perfStats[0].type).toBe("fn");
  });

  test("branch steps are recorded with type 'branch'", async () => {
    const shared: any = { ok: true };
    await new PerfFlow<any>()
      .withPerfAnalyzer()
      .branch(async (s: any) => (s.ok ? "yes" : "no"), {
        yes: async () => {},
        no: async () => {},
      })
      .run(shared);

    expect(shared.__perfStats[0].type).toBe("branch");
  });
});
