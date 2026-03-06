// ---------------------------------------------------------------------------
// Flowneer — Compliance plugin barrel
// ---------------------------------------------------------------------------

export { withAuditFlow } from "./withAuditFlow";
export type {
  TaintRule,
  ViolationAction,
  ViolationLocation,
  ComplianceViolation,
  ComplianceReport,
} from "./withAuditFlow";

export {
  withRuntimeCompliance,
  makeRuntimeCompliancePlugin,
  ComplianceError,
} from "./withRuntimeCompliance";
export type {
  RuntimeInspector,
  RuntimeComplianceOptions,
} from "./withRuntimeCompliance";

export { scanShared } from "./pii";
export type { PiiMatch } from "./pii";
