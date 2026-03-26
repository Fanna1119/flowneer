// ---------------------------------------------------------------------------
// Flowneer — barrel re-export
//
// The implementation has been split into src/ for maintainability.
// This file preserves the original import path for all consumers.
// ---------------------------------------------------------------------------

export {
  FlowBuilder,
  CoreFlowBuilder,
  Fragment,
  fragment,
  FlowError,
  InterruptError,
} from "./src";

export type {
  Validator,
  StreamEvent,
  NodeFn,
  NumberOrFn,
  NodeOptions,
  RunOptions,
  StepMeta,
  StepFilter,
  FlowHooks,
  FlowneerPlugin,
  PluginContext,
  FnStep,
  BranchStep,
  LoopStep,
  BatchStep,
  ParallelStep,
  AnchorStep,
  DagStep,
  Step,
  StepContext,
  StepHandler,
} from "./src";
