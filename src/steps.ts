// ---------------------------------------------------------------------------
// Flowneer — internal step representations
// ---------------------------------------------------------------------------

import type { CoreFlowBuilder } from "./core/CoreFlowBuilder";
import type { NodeFn, NodeOptions, NumberOrFn } from "./types";

export interface FnStep<S, P extends Record<string, unknown>> {
  type: "fn";
  fn: NodeFn<S, P>;
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
  label?: string;
}

export interface BranchStep<S, P extends Record<string, unknown>> {
  type: "branch";
  router: NodeFn<S, P>;
  branches: Record<string, NodeFn<S, P>>;
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
  label?: string;
}

export interface LoopStep<S, P extends Record<string, unknown>> {
  type: "loop";
  condition: (shared: S, params: P) => Promise<boolean> | boolean;
  body: CoreFlowBuilder<S, P>;
  label?: string;
}

export interface BatchStep<S, P extends Record<string, unknown>> {
  type: "batch";
  itemsExtractor: (shared: S, params: P) => Promise<any[]> | any[];
  processor: CoreFlowBuilder<S, P>;
  key: string;
  label?: string;
}

export interface ParallelStep<S, P extends Record<string, unknown>> {
  type: "parallel";
  fns: NodeFn<S, P>[];
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
  reducer?: (shared: S, drafts: S[]) => void;
  label?: string;
}

export interface AnchorStep {
  type: "anchor";
  name: string;
  /** Maximum number of times a goto may jump to this anchor per run. */
  maxVisits?: number;
}

/**
 * A compiled DAG step. Produced by the graph plugin's `.compile()` and
 * executed by the registered "dag" step handler, which traverses nodes
 * in topological order and fires per-node lifecycle hooks natively.
 */
export interface DagStep<S, P extends Record<string, unknown>> {
  type: "dag";
  nodes: Map<
    string,
    { name: string; fn: NodeFn<S, P>; options?: NodeOptions<S, P> }
  >;
  /** Topologically sorted node names. */
  order: string[];
  /** Conditional edges that point backwards (cycles). Always have a condition. */
  backEdges: Array<{
    from: string;
    to: string;
    condition: (shared: S, params: P) => boolean | Promise<boolean>;
  }>;
  /** Conditional edges that skip forward (not back-edges). Always have a condition. */
  conditionalForward: Array<{
    from: string;
    to: string;
    condition: (shared: S, params: P) => boolean | Promise<boolean>;
  }>;
  label?: string;
}

export type Step<S, P extends Record<string, unknown>> =
  | FnStep<S, P>
  | BranchStep<S, P>
  | LoopStep<S, P>
  | BatchStep<S, P>
  | ParallelStep<S, P>
  | AnchorStep
  | DagStep<S, P>;
