// ---------------------------------------------------------------------------
// Flowneer — internal step representations
// ---------------------------------------------------------------------------

import type { FlowBuilder } from "./FlowBuilder";
import type { NodeFn, NumberOrFn } from "./types";

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
  body: FlowBuilder<S, P>;
  label?: string;
}

export interface BatchStep<S, P extends Record<string, unknown>> {
  type: "batch";
  itemsExtractor: (shared: S, params: P) => Promise<any[]> | any[];
  processor: FlowBuilder<S, P>;
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
}

export type Step<S, P extends Record<string, unknown>> =
  | FnStep<S, P>
  | BranchStep<S, P>
  | LoopStep<S, P>
  | BatchStep<S, P>
  | ParallelStep<S, P>
  | AnchorStep;
