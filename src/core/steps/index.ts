// ---------------------------------------------------------------------------
// Register all primitive step type handlers.
// Call registerBuiltinSteps() once to enable all built-in step types.
//
// FlowBuilder calls this automatically, so consumers of 'flowneer' never
// need to call it explicitly.
// ---------------------------------------------------------------------------
import { CoreFlowBuilder } from "../CoreFlowBuilder";
import { fnHandler } from "./fn";
import { branchHandler } from "./branch";
import { loopHandler } from "./loop";
import { batchHandler } from "./batch";
import { parallelHandler } from "./parallel";
import { anchorHandler } from "./anchor";

export function registerBuiltinSteps(): void {
  CoreFlowBuilder.registerStepType("fn", fnHandler);
  CoreFlowBuilder.registerStepType("branch", branchHandler);
  CoreFlowBuilder.registerStepType("loop", loopHandler);
  CoreFlowBuilder.registerStepType("batch", batchHandler);
  CoreFlowBuilder.registerStepType("parallel", parallelHandler);
  CoreFlowBuilder.registerStepType("anchor", anchorHandler);
}
