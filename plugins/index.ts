// Observability
export {
  withTiming,
  withHistory,
  withVerbose,
  withInterrupts,
} from "./observability/index";

// Resilience
export {
  withFallback,
  withCircuitBreaker,
  withTimeout,
  withCycles,
} from "./resilience/index";
export type { CircuitBreakerOptions } from "./resilience/index";

// Persistence
export {
  withCheckpoint,
  withAuditLog,
  withReplay,
  withVersionedCheckpoint,
} from "./persistence/index";
export type {
  CheckpointStore,
  AuditEntry,
  AuditLogStore,
  VersionedCheckpointEntry,
  VersionedCheckpointStore,
} from "./persistence/index";

// LLM
export { withTokenBudget, withCostTracker, withRateLimit } from "./llm/index";
export type { RateLimitOptions } from "./llm/index";

// Dev / Testing
export {
  withDryRun,
  withMocks,
  withStepLimit,
  withAtomicUpdates,
  withFlowAnalyzer,
} from "./dev/index";
export type {
  PathNode,
  PathMap,
  TraceEvent,
  TraceReport,
  TraceHandle,
} from "./dev/index";

// Messaging
export {
  withChannels,
  sendTo,
  receiveFrom,
  peekChannel,
  withStream,
  emit,
} from "./messaging/index";
export type { StreamSubscriber } from "./messaging/index";

// Tools
export {
  withTools,
  ToolRegistry,
  getTools,
  executeTool,
  executeTools,
} from "./tools/index";
export type { Tool, ToolParam, ToolCall, ToolResult } from "./tools/index";

// Agent plugins
export { withHumanNode, resumeFlow } from "./agent/index";
export type { HumanNodeOptions } from "./agent/index";

// Memory
export {
  withMemory,
  BufferWindowMemory,
  SummaryMemory,
  KVMemory,
} from "./memory/index";
export type {
  Memory,
  MemoryMessage,
  BufferWindowOptions,
  SummaryMemoryOptions,
} from "./memory/index";

// Output helpers
export {
  parseJsonOutput,
  parseListOutput,
  parseMarkdownTable,
  parseRegexOutput,
} from "./output/index";

// Telemetry
export {
  withTelemetry,
  TelemetryDaemon,
  consoleExporter,
  otlpExporter,
} from "./telemetry/index";
export type {
  Span,
  TelemetryExporter,
  TelemetryOptions,
} from "./telemetry/index";

// Evaluation
export {
  exactMatch,
  containsMatch,
  f1Score,
  retrievalPrecision,
  retrievalRecall,
  answerRelevance,
  runEvalSuite,
} from "./eval/index";
export type { ScoreFn, EvalResult, EvalSummary } from "./eval/index";

// Graph
export { withGraph } from "./graph/index";
export type { GraphNode, GraphEdge } from "./graph/index";

// Compliance
export {
  withAuditFlow,
  withRuntimeCompliance,
  makeRuntimeCompliancePlugin,
  ComplianceError,
  scanShared,
} from "./compliance/index";
export type {
  TaintRule,
  ViolationAction,
  ViolationLocation,
  ComplianceViolation,
  ComplianceReport,
  RuntimeInspector,
  RuntimeComplianceOptions,
  PiiMatch,
} from "./compliance/index";

// Config — types and validate helper
export { validate } from "./config/index";
export type {
  FlowConfig,
  StepConfig,
  FnRegistry,
  ValidationError,
  ValidationResult,
} from "./config/index";
