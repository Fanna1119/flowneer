// ---------------------------------------------------------------------------
// Flowneer — src barrel
// ---------------------------------------------------------------------------

export { FlowBuilder } from "./FlowBuilder";
export { CoreFlowBuilder } from "./core/CoreFlowBuilder";
export { Fragment, fragment } from "./Fragment";
export { FlowError, InterruptError } from "./errors";

export type {
  StepContext,
  StepHandler,
  ResolvedHooks,
} from "./core/CoreFlowBuilder";

export type {
  FnStep,
  BranchStep,
  LoopStep,
  BatchStep,
  ParallelStep,
  AnchorStep,
  DagStep,
  Step,
} from "./steps";

export type {
  AugmentedState,
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
} from "./types";
