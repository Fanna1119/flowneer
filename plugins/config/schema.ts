// ---------------------------------------------------------------------------
// FlowConfig — JSON schema types for config-driven flow definition
// ---------------------------------------------------------------------------

/**
 * A reference to a function in the user-supplied registry.
 * The string must resolve to a key in the `FnRegistry` passed to `build()`.
 */
export type FnRef = string;

/**
 * Escape-hatch for step types registered via `JsonFlowBuilder.registerStepBuilder()`.
 * Any object with a `type` string that is not one of the built-in types satisfies
 * this interface, so custom steps can be used in `FlowConfig` without casting.
 */
export interface CustomStepConfig {
  type: string;
  [key: string]: unknown;
}

export type StepConfig =
  | FnStepConfig
  | BranchStepConfig
  | LoopStepConfig
  | BatchStepConfig
  | ParallelStepConfig
  | AnchorStepConfig
  | CustomStepConfig;

export interface FnStepConfig {
  type: "fn";
  /** Registry key for the NodeFn to execute. */
  fn: FnRef;
  label?: string;
  retries?: number;
  delaySec?: number;
  timeoutMs?: number;
}

export interface BranchStepConfig {
  type: "branch";
  /** Registry key for the router NodeFn (returns a branch key). */
  router: FnRef;
  /** Map of branch key → registry key for the branch NodeFn. */
  branches: Record<string, FnRef>;
  label?: string;
  retries?: number;
  delaySec?: number;
  timeoutMs?: number;
}

export interface LoopStepConfig {
  type: "loop";
  /** Registry key for the condition function (returns boolean). */
  condition: FnRef;
  body: StepConfig[];
  label?: string;
}

export interface BatchStepConfig {
  type: "batch";
  /** Registry key for the items extractor function (returns array). */
  items: FnRef;
  processor: StepConfig[];
  key?: string;
  label?: string;
}

export interface ParallelStepConfig {
  type: "parallel";
  /** Registry keys for all parallel NodeFns. */
  fns: FnRef[];
  label?: string;
  retries?: number;
  delaySec?: number;
  timeoutMs?: number;
}

export interface AnchorStepConfig {
  type: "anchor";
  name: string;
  maxVisits?: number;
}

/** Root flow configuration — a flat or nested list of steps. */
export interface FlowConfig {
  steps: StepConfig[];
}

/** A map of function names to actual function implementations. */
export type FnRegistry = Record<string, Function>;

/** A single validation error, with a dot-path to the problem. */
export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
