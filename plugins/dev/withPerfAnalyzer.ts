// ---------------------------------------------------------------------------
// withPerfAnalyzer — per-step heap, CPU, and GC profiling
// ---------------------------------------------------------------------------
// Uses only Node.js built-in perf APIs — zero external dependencies:
//
//   performance.now()       — high-resolution wall-clock (sub-ms precision)
//   process.cpuUsage(prev)  — user + system CPU time delta (µs → ms)
//   process.memoryUsage()   — heapUsed, rss, external memory snapshots
//   PerformanceObserver     — GC entry accumulation ("gc" entryType)
//
// Writes per-step stats to  shared.__perfStats[]
// Writes a flow summary to  shared.__perfReport
//
// Note: per-step GC attribution is best-effort. PerformanceObserver fires
// asynchronously, so GC events are accumulated globally and distributed to
// steps proportionally. Use __perfReport.totalGcDurationMs for authoritative
// flow-level GC overhead.
//
// Note: cpuUserMs / cpuSystemMs measure process-wide CPU delta during each
// step. Results are approximate for concurrent steps (e.g. inside .parallel()).
// ---------------------------------------------------------------------------

import { performance, PerformanceObserver } from "node:perf_hooks";
import type {
  FlowneerPlugin,
  PluginContext,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Per-step performance snapshot recorded by `.withPerfAnalyzer()`. */
export interface StepPerfStats {
  /** Step index (0-based). */
  index: number;
  /** Step type: "fn" | "branch" | "loop" | "batch" | "parallel" | "dag". */
  type: string;
  /** Step label if set via `NodeOptions.label`. */
  label?: string;

  // ── Timing ──────────────────────────────────────────────────────────────
  /** Wall-clock duration in ms (high-res via `performance.now()`). */
  durationMs: number;

  // ── CPU ─────────────────────────────────────────────────────────────────
  /** User-space CPU time consumed during this step (ms). 0 on non-Node runtimes. */
  cpuUserMs: number;
  /** Kernel CPU time consumed during this step (ms). 0 on non-Node runtimes. */
  cpuSystemMs: number;

  // ── Heap ────────────────────────────────────────────────────────────────
  /** V8 heap used at step start (bytes). */
  heapUsedBefore: number;
  /** V8 heap used at step end (bytes). */
  heapUsedAfter: number;
  /**
   * Net change in V8 heap usage (bytes, positive = allocated, negative = freed
   * due to a GC cycle that completed during the step).
   */
  heapDeltaBytes: number;
  /** Net change in Resident Set Size (bytes). */
  rssDeltaBytes: number;
  /** Net change in external (C++ / Buffer) memory bound to V8 (bytes). */
  externalDeltaBytes: number;

  // ── GC ──────────────────────────────────────────────────────────────────
  /**
   * Number of GC events accumulated since last step end. Best-effort; see
   * module note regarding async PerformanceObserver delivery.
   */
  gcCount: number;
  /** Total GC pause duration attributed to this step (ms). Best-effort. */
  gcDurationMs: number;

  // ── Error flag ───────────────────────────────────────────────────────────
  /** `true` if the step threw an error (stats still recorded via finally). */
  threw: boolean;
}

/** Flow-level performance summary written to `shared.__perfReport`. */
export interface PerfReport {
  /** Sum of all step `durationMs` (includes parallel overlap). */
  totalDurationMs: number;
  /** Sum of all step `cpuUserMs`. */
  totalCpuUserMs: number;
  /** Sum of all step `cpuSystemMs`. */
  totalCpuSystemMs: number;
  /** Sum of all GC pause durations across the flow (ms). */
  totalGcDurationMs: number;
  /** Total GC event count during the flow. */
  totalGcCount: number;
  /** Highest `heapUsedAfter` seen across all steps (bytes). */
  peakHeapUsedBytes: number;
  /** All per-step stats in execution order. */
  steps: StepPerfStats[];
  /** The step with the longest wall-clock duration, or `null` if no steps ran. */
  slowest: StepPerfStats | null;
  /** The step with the largest heap delta, or `null` if no steps ran. */
  heaviest: StepPerfStats | null;
}

export interface PerfAnalyzerOptions {
  /**
   * Track GC pause events via `PerformanceObserver`. Requires Node.js.
   * @default true
   */
  trackGc?: boolean;
  /**
   * Called with the final `PerfReport` in `afterFlow`.
   * Use this to log, persist, or ship metrics — formatting is left to the caller.
   */
  onReport?: (report: PerfReport) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Profiles each step using Node.js built-in performance APIs — no external
     * dependencies.
     *
     * Per step, records:
     * - Wall-clock duration (`performance.now()`)
     * - CPU user + system time (`process.cpuUsage()`)
     * - Heap used delta (`process.memoryUsage().heapUsed`)
     * - RSS and external memory delta
     * - GC pause count + duration (`PerformanceObserver`, best-effort)
     *
     * Results are written to `shared.__perfStats` (array, in execution order)
     * and `shared.__perfReport` (flow summary) when the flow completes.
     *
     * @example
     * const flow = new AppFlow<State>()
     *   .withPerfAnalyzer({
     *     onReport: (r) => console.log(JSON.stringify(r, null, 2)),
     *   })
     *   .then(fetchData, { label: "fetch" })
     *   .then(callLlm,   { label: "llm:generate" })
     *   .then(save,      { label: "save" });
     *
     * await flow.run(shared);
     * // shared.__perfReport.slowest → { label: "llm:generate", durationMs: ... }
     * // shared.__perfStats[0]       → { heapDeltaBytes: 2621440, cpuUserMs: 12 … }
     *
     * @example
     * // Profile only LLM steps
     * flow.withPerfAnalyzer({}, ["llm:*"])
     */
    withPerfAnalyzer(options?: PerfAnalyzerOptions, filter?: StepFilter): this;
  }
  interface AugmentedState {
    /** Per-step perf stats written by `.withPerfAnalyzer()`. In execution order. */
    __perfStats?: StepPerfStats[];
    /** Flow-level perf summary written by `.withPerfAnalyzer()` on flow completion. */
    __perfReport?: PerfReport;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function cpuUsage(): NodeJS.CpuUsage {
  return (
    (process.cpuUsage as (() => NodeJS.CpuUsage) | undefined)?.() ?? {
      user: 0,
      system: 0,
    }
  );
}

function cpuUsageDelta(start: NodeJS.CpuUsage): NodeJS.CpuUsage {
  return (
    (
      process.cpuUsage as ((s: NodeJS.CpuUsage) => NodeJS.CpuUsage) | undefined
    )?.(start) ?? { user: 0, system: 0 }
  );
}

function memUsage(): NodeJS.MemoryUsage {
  return (
    (process.memoryUsage as (() => NodeJS.MemoryUsage) | undefined)?.() ?? {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export const withPerfAnalyzer: FlowneerPlugin = {
  withPerfAnalyzer(
    this: PluginContext,
    options: PerfAnalyzerOptions = {},
    filter?: StepFilter,
  ) {
    const { trackGc = true, onReport } = options;

    // Accumulated GC events for the lifetime of this flow.
    // PerformanceObserver fires asynchronously, so this array is shared and
    // we snapshot `.length` and the running total at step boundaries.
    const gcLog: Array<{ startTime: number; duration: number }> = [];
    let gcObserver: PerformanceObserver | null = null;

    if (trackGc) {
      try {
        gcObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            gcLog.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        gcObserver.observe({ entryTypes: ["gc"] });
      } catch {
        // GC observability not supported in this runtime — graceful degradation.
      }
    }

    // Per-step snapshot data keyed by step index (supports concurrent steps
    // inside .parallel()).
    const snapshots = new Map<
      number,
      {
        t0: number;
        cpu0: NodeJS.CpuUsage;
        mem0: NodeJS.MemoryUsage;
        gcLenBefore: number;
        gcMsBefore: number;
      }
    >();

    this._setHooks(
      {
        wrapStep: async (
          meta: StepMeta,
          next: () => Promise<void>,
          shared: any,
        ) => {
          // ── Snapshot before ───────────────────────────────────────────────
          const gcMsBefore = gcLog.reduce((a, e) => a + e.duration, 0);
          const t0 = performance.now();
          const cpu0 = cpuUsage();
          const mem0 = memUsage();
          snapshots.set(meta.index, {
            t0,
            cpu0,
            mem0,
            gcLenBefore: gcLog.length,
            gcMsBefore,
          });

          let threw = false;
          try {
            await next();
          } catch (e) {
            threw = true;
            throw e;
          } finally {
            // ── Snapshot after ─────────────────────────────────────────────
            const durationMs = performance.now() - t0;
            const cpuDelta = cpuUsageDelta(cpu0);
            const mem1 = memUsage();
            const snap = snapshots.get(meta.index);
            snapshots.delete(meta.index);

            const gcMsAfter = gcLog.reduce((a, e) => a + e.duration, 0);
            const gcCountAfter = gcLog.length;
            const gcLenBefore = snap?.gcLenBefore ?? gcLog.length;
            const gcMsSnap = snap?.gcMsBefore ?? gcMsAfter;

            const stat: StepPerfStats = {
              index: meta.index,
              type: meta.type,
              label: meta.label,
              durationMs,
              cpuUserMs: cpuDelta.user / 1000,
              cpuSystemMs: cpuDelta.system / 1000,
              heapUsedBefore: mem0.heapUsed,
              heapUsedAfter: mem1.heapUsed,
              heapDeltaBytes: mem1.heapUsed - mem0.heapUsed,
              rssDeltaBytes: mem1.rss - mem0.rss,
              externalDeltaBytes: mem1.external - mem0.external,
              gcCount: gcCountAfter - gcLenBefore,
              gcDurationMs: gcMsAfter - gcMsSnap,
              threw,
            };

            if (!shared.__perfStats) shared.__perfStats = [];
            (shared.__perfStats as StepPerfStats[]).push(stat);
          }
        },

        afterFlow: (shared: any) => {
          gcObserver?.disconnect();

          const stats: StepPerfStats[] = shared.__perfStats ?? [];

          const totalGcDurationMs = gcLog.reduce((a, e) => a + e.duration, 0);
          const totalGcCount = gcLog.length;

          const report: PerfReport = {
            totalDurationMs: stats.reduce((a, s) => a + s.durationMs, 0),
            totalCpuUserMs: stats.reduce((a, s) => a + s.cpuUserMs, 0),
            totalCpuSystemMs: stats.reduce((a, s) => a + s.cpuSystemMs, 0),
            totalGcDurationMs,
            totalGcCount,
            peakHeapUsedBytes: stats.reduce(
              (a, s) => Math.max(a, s.heapUsedAfter),
              0,
            ),
            steps: stats,
            slowest:
              stats.length > 0
                ? stats.reduce((a, s) => (s.durationMs > a.durationMs ? s : a))
                : null,
            heaviest:
              stats.length > 0
                ? stats.reduce((a, s) =>
                    s.heapDeltaBytes > a.heapDeltaBytes ? s : a,
                  )
                : null,
          };

          shared.__perfReport = report;

          onReport?.(report);
        },
      },
      filter,
    );

    return this;
  },
};
