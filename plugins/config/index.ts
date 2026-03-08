// ---------------------------------------------------------------------------
// Flowneer — Config plugin barrel
// ---------------------------------------------------------------------------

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
