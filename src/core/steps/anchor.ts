// ---------------------------------------------------------------------------
// anchor step handler
//
// Anchors are pure no-op markers — the execution engine's _execute() loop
// skips them via `continue` before dispatch. This registration exists only
// so custom tooling can enumerate all known step types consistently.
//
// The maxVisits cycle-limit is enforced directly by _execute() at goto
// resolution time (not here), because at that point we know the visit count.
// ---------------------------------------------------------------------------
import type { StepHandler } from "../CoreFlowBuilder";

export const anchorHandler: StepHandler = async () => undefined;
