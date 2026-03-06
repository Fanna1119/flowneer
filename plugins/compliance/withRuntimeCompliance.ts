// ---------------------------------------------------------------------------
// withRuntimeCompliance — runtime compliance checks for FlowBuilder
// ---------------------------------------------------------------------------
//
// Installs a wrapStep hook that calls user-supplied inspector functions
// before each step executes. Inspectors can throw, warn, or record violations.
//
// ---------------------------------------------------------------------------

import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
  InstancePlugin,
} from "../../Flowneer";
import { FlowError } from "../../Flowneer";
import type { ViolationAction } from "./withAuditFlow";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A runtime inspector that checks shared state at a specific step.
 *
 * Return a non-null string to signal a violation — the string is used as the
 * violation message. Return `null` to pass.
 */
export interface RuntimeInspector<S> {
  /** If provided, only fires for steps matching this filter. */
  filter?: StepFilter;
  /**
   * Called before the step executes.
   * Return a violation message string, or `null` to pass.
   */
  check: (shared: S, meta: StepMeta) => string | null | Promise<string | null>;
  /** Defaults to `"throw"`. */
  onViolation?: ViolationAction;
}

export interface RuntimeComplianceOptions {
  /** Default action for inspectors that don't specify one. Defaults to `"throw"`. */
  defaultAction?: ViolationAction;
}

/**
 * Thrown when an inspector fires with `onViolation: "throw"`.
 *
 * Extends `FlowError` so it bypasses the engine's re-wrapping and reaches
 * callers as-is. `instanceof ComplianceError` checks work normally.
 */
export class ComplianceError extends FlowError {
  constructor(
    public readonly inspector: RuntimeInspector<any>,
    public readonly meta: StepMeta,
    violationMessage: string,
  ) {
    super(
      `step ${meta.index}${meta.label ? ` "${meta.label}"` : ""}`,
      new Error(`[compliance] ${violationMessage}`),
    );
    this.name = "ComplianceError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter matching (mirrors CoreFlowBuilder – avoids importing private util)
// ─────────────────────────────────────────────────────────────────────────────

function matchesFilter(filter: StepFilter, meta: StepMeta): boolean {
  if (typeof filter === "function") return filter(meta);
  if (meta.label === undefined) return false;
  const label = meta.label;
  return filter.some((pattern) => {
    if (!pattern.includes("*")) return pattern === label;
    const re = new RegExp(
      "^" +
        pattern
          .split("*")
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    );
    return re.test(label);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Module augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Install runtime compliance inspectors on this flow.
     *
     * Each inspector is called before its matched step executes. If it returns
     * a non-null string, the violation is handled according to `onViolation`:
     * - `"throw"` (default) — throws `ComplianceError`.
     * - `"warn"` — writes to stderr and continues.
     * - `"record"` — pushes to `shared.__complianceViolations` and continues.
     *
     * @example
     * flow.withRuntimeCompliance([{
     *   filter: (meta) => meta.label?.startsWith("external:") ?? false,
     *   check: (shared) => {
     *     const hits = scanShared(shared, ["user.email"]);
     *     return hits.length > 0
     *       ? `PII found before external call: ${hits.map(h => h.path).join(", ")}`
     *       : null;
     *   },
     *   onViolation: "throw",
     * }]);
     */
    withRuntimeCompliance(
      inspectors: RuntimeInspector<S>[],
      options?: RuntimeComplianceOptions,
    ): this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InstancePlugin factory
// ─────────────────────────────────────────────────────────────────────────────

export function makeRuntimeCompliancePlugin<S>(
  inspectors: RuntimeInspector<S>[],
  options: RuntimeComplianceOptions = {},
): InstancePlugin<S, any> {
  const defaultAction: ViolationAction = options.defaultAction ?? "throw";

  return (flow) => {
    flow.addHooks({
      wrapStep: async (
        meta: StepMeta,
        next: () => Promise<void>,
        shared: S,
      ) => {
        for (const inspector of inspectors) {
          if (inspector.filter && !matchesFilter(inspector.filter, meta))
            continue;

          const result = await inspector.check(shared, meta);
          if (result !== null) {
            const action = inspector.onViolation ?? defaultAction;
            if (action === "throw") {
              throw new ComplianceError(inspector, meta, result);
            } else if (action === "warn") {
              console.warn(
                `[compliance warning] ${result} (step ${meta.index}${meta.label ? `: "${meta.label}"` : ""})`,
              );
            } else {
              // "record"
              const s = shared as any;
              if (!s.__complianceViolations) s.__complianceViolations = [];
              s.__complianceViolations.push({ message: result, meta });
            }
          }
        }
        await next();
      },
    });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin — adds .withRuntimeCompliance() to FlowBuilder prototype
// ─────────────────────────────────────────────────────────────────────────────

export const withRuntimeCompliance: FlowneerPlugin = {
  withRuntimeCompliance(
    this: FlowBuilder<any, any>,
    inspectors: RuntimeInspector<any>[],
    options?: RuntimeComplianceOptions,
  ) {
    this.with(makeRuntimeCompliancePlugin(inspectors, options));
    return this;
  },
};
