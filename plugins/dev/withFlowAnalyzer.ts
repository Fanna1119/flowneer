// ---------------------------------------------------------------------------
// withFlowAnalyzer — static path map + runtime execution trace
// ---------------------------------------------------------------------------
//
// Two complementary tools:
//   .analyzeFlow()  — synchronous static walk; answers "what paths are possible?"
//   .withTrace()    — installs hooks; answers "what path was actually taken?"
//
// Both are non-destructive. withTrace() returns a dispose() handle so hooks
// can be removed after use. Composable with withDryRun:
//
//   flow.withDryRun().withTrace()  → trace paths without executing any logic
//
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";
import type { Step } from "../../src/steps";

// ─────────────────────────────────────────────────────────────────────────────
// Public types — static
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single node in the static path tree.
 */
export interface PathNode {
  /** Stable id: `"fn_0"`, `"branch_2"`, `"anchor:refine"`, etc. */
  id: string;
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  label?: string;
  /** Branch arms — keys are the branch names, values are the arm subtrees. */
  branches?: Record<string, PathNode[]>;
  /** Inline body steps (loop / batch). */
  body?: PathNode[];
  /** One lane per parallel fn. */
  parallel?: PathNode[][];
}

/**
 * The result of `.analyzeFlow()`.
 */
export interface PathMap {
  nodes: PathNode[];
  /** All anchor names declared in this flow (and nested sub-flows). */
  anchors: string[];
  /**
   * True if any `fn` step exists — those can dynamically return goto targets
   * (`"#anchorName"`) that cannot be resolved without running the flow.
   * Static analysis is therefore necessarily conservative for those edges.
   */
  hasDynamicGotos: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types — runtime trace
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceEvent {
  stepIndex: number;
  type: string;
  label?: string;
  durationMs: number;
}

export interface TraceReport {
  events: TraceEvent[];
  totalDurationMs: number;
  /** Human-readable ordered list of visited step labels (unlabelled steps are skipped). */
  pathSummary: string[];
}

export interface TraceHandle {
  /** Returns the trace collected so far. Safe to call mid-run. */
  getTrace(): TraceReport;
  /** Removes the installed hooks. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static walker
// ─────────────────────────────────────────────────────────────────────────────

interface WalkResult {
  nodes: PathNode[];
  anchors: string[];
  hasDynamicGotos: boolean;
}

function walkSteps(steps: Step<any, any>[], prefix: string = ""): WalkResult {
  const nodes: PathNode[] = [];
  const anchors: string[] = [];
  let hasDynamicGotos = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const rawId =
      step.type === "anchor" ? `anchor:${step.name}` : `${step.type}_${i}`;
    const id = prefix ? `${prefix}:${rawId}` : rawId;

    switch (step.type) {
      case "fn": {
        hasDynamicGotos = true; // fn steps may return goto strings
        nodes.push({
          id,
          type: "fn",
          label: (step as any).label ?? (step.fn as any)?.name,
        });
        break;
      }

      case "anchor": {
        anchors.push(step.name);
        nodes.push({ id, type: "anchor", label: step.name });
        break;
      }

      case "branch": {
        const branchMap: Record<string, PathNode[]> = {};
        for (const [key, fn] of Object.entries(step.branches ?? {})) {
          branchMap[key] = [
            {
              id: `${id}:arm:${key}`,
              type: "fn",
              label: (fn as any)?.name ?? key,
            },
          ];
          hasDynamicGotos = true;
        }
        nodes.push({
          id,
          type: "branch",
          label: (step as any).label ?? (step.router as any)?.name,
          branches: branchMap,
        });
        break;
      }

      case "loop": {
        const bodySteps: Step<any, any>[] = (step.body as any)?.steps ?? [];
        const inner = walkSteps(bodySteps, `${id}:body`);
        anchors.push(...inner.anchors);
        hasDynamicGotos = hasDynamicGotos || inner.hasDynamicGotos;
        nodes.push({
          id,
          type: "loop",
          label: (step as any).label,
          body: inner.nodes,
        });
        break;
      }

      case "batch": {
        const procSteps: Step<any, any>[] =
          (step.processor as any)?.steps ?? [];
        const inner = walkSteps(procSteps, `${id}:each`);
        anchors.push(...inner.anchors);
        hasDynamicGotos = hasDynamicGotos || inner.hasDynamicGotos;
        nodes.push({
          id,
          type: "batch",
          label: (step as any).label,
          body: inner.nodes,
        });
        break;
      }

      case "parallel": {
        const fns: any[] = (step as any).fns ?? [];
        const lanes: PathNode[][] = fns.map((fn, fi) => [
          {
            id: `${id}:fn_${fi}`,
            type: "fn" as const,
            label: fn?.name ?? `fn_${fi}`,
          },
        ]);
        hasDynamicGotos = hasDynamicGotos || fns.length > 0;
        nodes.push({
          id,
          type: "parallel",
          label: (step as any).label,
          parallel: lanes,
        });
        break;
      }

      default:
        break;
    }
  }

  return { nodes, anchors, hasDynamicGotos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Statically analyze this flow and return a `PathMap` describing all
     * possible nodes and anchors without executing anything.
     *
     * `hasDynamicGotos` is true whenever `fn` steps are present — those may
     * return goto targets at runtime that cannot be resolved statically.
     *
     * @example
     * const map = flow.analyzeFlow();
     * console.log("anchors:", map.anchors);
     * console.log("has dynamic gotos:", map.hasDynamicGotos);
     */
    analyzeFlow(): PathMap;

    /**
     * Install execution-trace hooks on this flow.
     *
     * Records every step's index, type, label, and wall-clock duration.
     * Call `getTrace()` after (or during) the run to inspect results.
     * Call `dispose()` to remove the hooks when no longer needed.
     *
     * Composable with `withDryRun` — trace structure without side effects:
     * ```ts
     * flow.withDryRun().withTrace()
     * ```
     *
     * @example
     * const trace = flow.withTrace();
     * await flow.run(shared);
     * console.log(trace.getTrace().pathSummary);
     * trace.dispose();
     */
    withTrace(): TraceHandle;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export const withFlowAnalyzer: FlowneerPlugin = {
  analyzeFlow(this: FlowBuilder<any, any>): PathMap {
    const steps: Step<any, any>[] = (this as any).steps ?? [];
    const { nodes, anchors, hasDynamicGotos } = walkSteps(steps);
    return { nodes, anchors, hasDynamicGotos };
  },

  withTrace(this: FlowBuilder<any, any>): TraceHandle {
    const events: TraceEvent[] = [];
    const starts = new Map<number, number>();

    const dispose = (this as any).addHooks({
      beforeStep: (meta: StepMeta) => {
        starts.set(meta.index, Date.now());
      },
      afterStep: (meta: StepMeta) => {
        const start = starts.get(meta.index) ?? Date.now();
        const durationMs = Date.now() - start;
        starts.delete(meta.index);
        events.push({
          stepIndex: meta.index,
          type: meta.type,
          label: meta.label,
          durationMs,
        });
      },
    });

    return {
      getTrace(): TraceReport {
        const totalDurationMs = events.reduce((s, e) => s + e.durationMs, 0);
        const pathSummary = events
          .filter((e) => e.label !== undefined)
          .map((e) => e.label as string);
        return { events: [...events], totalDurationMs, pathSummary };
      },
      dispose,
    };
  },
};
