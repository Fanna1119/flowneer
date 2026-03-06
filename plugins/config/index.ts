// ---------------------------------------------------------------------------
// Flowneer — Config plugin barrel
// ---------------------------------------------------------------------------

export { JsonFlowBuilder, ConfigValidationError } from "./build";
export type { CustomStepBuilder } from "./build";

export { validate } from "./validate";

export type {
  FlowConfig,
  StepConfig,
  FnStepConfig,
  BranchStepConfig,
  LoopStepConfig,
  BatchStepConfig,
  ParallelStepConfig,
  AnchorStepConfig,
  FnRegistry,
  ValidationError,
  ValidationResult,
} from "./schema";
