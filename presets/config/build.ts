// ---------------------------------------------------------------------------
// build — compile a FlowConfig into an executable FlowBuilder
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type {
  StepConfig,
  FlowConfig,
  FnRegistry,
} from "../../plugins/config/schema";
import { validate } from "../../plugins/config/validate";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Recursive applicator passed to nested step builders (loop body, batch processor). */
export type ApplyFn = (
  steps: StepConfig[],
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
) => void;

/**
 * A step config builder: receives the raw step descriptor, the flow being
 * assembled, the fn registry, and a `recurse` helper for nested sub-steps
 * (loop body, batch processor). Responsible for calling the appropriate
 * `FlowBuilder` methods.
 *
 * Register built-ins or custom types via `JsonFlowBuilder.registerStepBuilder()`.
 * Mirrors the `CoreFlowBuilder.registerStepType()` pattern.
 */
export type StepConfigBuilder = (
  step: StepConfig & { type: string },
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
  recurse: ApplyFn,
) => void;

/** @deprecated Use `StepConfigBuilder`. Kept for backwards compatibility. */
export type CustomStepBuilder = StepConfigBuilder;

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(public readonly errors: { path: string; message: string }[]) {
    super(
      `FlowConfig validation failed:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`,
    );
    this.name = "ConfigValidationError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step builder dispatch table
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors CoreFlowBuilder._stepHandlers: built-in types are registered here
// at module init. Adding a new built-in step type only requires one entry here.
//
// _customTypes tracks user-registered types only — passed to validate() as
// `additionalTypes` so structural validation still applies to built-ins normally.

const _stepBuilders = new Map<string, StepConfigBuilder>();
const _customTypes = new Set<string>();

function pickOpts(step: Record<string, any>): Record<string, any> {
  const opts: Record<string, any> = {};
  if (step.label !== undefined) opts.label = step.label;
  if (step.retries !== undefined) opts.retries = step.retries;
  if (step.delaySec !== undefined) opts.delaySec = step.delaySec;
  if (step.timeoutMs !== undefined) opts.timeoutMs = step.timeoutMs;
  return opts;
}

// ── Built-in registrations ───────────────────────────────────────────────────

_stepBuilders.set("fn", (step: any, flow, registry) => {
  flow.then(registry[step.fn] as any, pickOpts(step));
});

_stepBuilders.set("branch", (step: any, flow, registry) => {
  const branches: Record<string, any> = {};
  for (const [key, ref] of Object.entries(
    step.branches as Record<string, string>,
  )) {
    branches[key] = registry[ref];
  }
  flow.branch(registry[step.router] as any, branches, pickOpts(step));
});

_stepBuilders.set("loop", (step: any, flow, registry, recurse) => {
  flow.loop(
    registry[step.condition] as any,
    (inner) => recurse(step.body, inner as any, registry),
    { label: step.label },
  );
});

_stepBuilders.set("batch", (step: any, flow, registry, recurse) => {
  const opts: Record<string, any> = {};
  if (step.key !== undefined) opts.key = step.key;
  if (step.label !== undefined) opts.label = step.label;
  flow.batch(
    registry[step.items] as any,
    (inner) => recurse(step.processor, inner as any, registry),
    opts,
  );
});

_stepBuilders.set("parallel", (step: any, flow, registry) => {
  const fns = (step.fns as string[]).map((ref) => registry[ref] as any);
  flow.parallel(fns, pickOpts(step));
});

_stepBuilders.set("anchor", (step: any, flow) => {
  flow.anchor(step.name, step.maxVisits);
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal recursive builder
// ─────────────────────────────────────────────────────────────────────────────

function applySteps(
  steps: StepConfig[],
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
): void {
  const recurse: ApplyFn = (subSteps, inner, reg) =>
    applySteps(subSteps, inner, reg);
  for (const step of steps) {
    _stepBuilders.get(step.type)?.(step as any, flow, registry, recurse);
    // Unknown types are silently skipped — validate() will have caught them
    // before build() is called.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JsonFlowBuilder — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds and validates `FlowBuilder` instances from a plain JSON configuration.
 *
 * @example
 * ```ts
 * const config: FlowConfig = {
 *   steps: [
 *     { type: "fn", fn: "fetchUser", label: "pii:user" },
 *     { type: "branch", router: "routeByScore",
 *       branches: { pass: "save", fail: "refine" } },
 *   ],
 * };
 * const registry = { fetchUser, routeByScore, save, refine };
 *
 * const flow = JsonFlowBuilder.build<MyState>(config, registry);
 * await flow.run(shared);
 * ```
 */
export class JsonFlowBuilder {
  /**
   * Validate a config object without building.
   *
   * @returns `{ valid, errors }` — errors is empty when valid.
   */
  static validate(config: unknown, registry: FnRegistry) {
    return validate(config, registry, _customTypes);
  }

  /**
   * Build a `FlowBuilder<S>` from a validated `FlowConfig`.
   *
   * Calls `validate()` first — throws `ConfigValidationError` if invalid.
   *
   * @throws `ConfigValidationError` when config is invalid.
   */
  static build<S = any>(
    config: FlowConfig,
    registry: FnRegistry,
    FlowClass: new () => FlowBuilder<S> = FlowBuilder as any,
  ): FlowBuilder<S> {
    const result = validate(config, registry, _customTypes);
    if (!result.valid) throw new ConfigValidationError(result.errors);

    const flow = new FlowClass();
    applySteps(config.steps, flow as any, registry);
    return flow;
  }

  /**
   * Register a step type compiler — for both custom and overriding built-in
   * types. Mirrors `CoreFlowBuilder.registerStepType()`.
   *
   * `recurse` is provided automatically for nested step types such as loop
   * bodies and batch processors.
   *
   * @example
   * JsonFlowBuilder.registerStepBuilder("sleep", (step, flow) => {
   *   flow.then(async () => new Promise(r => setTimeout(r, (step as any).ms)));
   * });
   */
  static registerStepBuilder(type: string, builder: StepConfigBuilder): void {
    _stepBuilders.set(type, builder);
    _customTypes.add(type);
  }
}
