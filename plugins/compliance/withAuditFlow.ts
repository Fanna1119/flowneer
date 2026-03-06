// ---------------------------------------------------------------------------
// withAuditFlow — static taint analysis for FlowBuilder
// ---------------------------------------------------------------------------
//
// Walks the compiled steps[] array and checks whether any "sink" step
// (e.g. an outbound HTTP call) can be reached after a "source" step
// (e.g. a PII-fetching step) according to user-supplied TaintRules.
//
// Purely structural — nothing is executed. Works on any flow, including
// nested loops, batches, and branches.
//
// ---------------------------------------------------------------------------

import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";
import type { Step } from "../../src/steps";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Behaviour when a compliance violation is detected.
 * - `"throw"` — throws `ComplianceError` immediately (default).
 * - `"warn"`  — logs to stderr, does not interrupt.
 * - `"record"` — collects into `shared.__complianceViolations`, does not interrupt.
 */
export type ViolationAction = "throw" | "warn" | "record";

/**
 * Declares that data flowing from any `source` step must never reach a `sink`
 * step further along the flow.
 */
export interface TaintRule {
  /** Steps that produce sensitive data. Matched by label via StepFilter. */
  source: StepFilter;
  /** Steps that send data outbound. Matched by label via StepFilter. */
  sink: StepFilter;
  /** Human-readable description, included in violation messages. */
  message?: string;
  /** What to do at runtime when the rule fires. Defaults to `"throw"`. */
  onViolation?: ViolationAction;
}

export interface ViolationLocation {
  index: number;
  label?: string;
}

export interface ComplianceViolation {
  rule: TaintRule;
  source: ViolationLocation;
  sink: ViolationLocation;
}

export interface ComplianceReport {
  passed: boolean;
  violations: ComplianceViolation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter matching — mirrors CoreFlowBuilder.matchesFilter (private)
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
// Flat step collector — returns {index, label} for every step
// Recurses into loop bodies and batch processors.
// ─────────────────────────────────────────────────────────────────────────────

interface FlatStep {
  index: number;
  label: string | undefined;
  type: string;
}

function collectSteps(
  steps: Step<any, any>[],
  baseIndex: number = 0,
): FlatStep[] {
  const result: FlatStep[] = [];
  let offset = baseIndex;

  for (const step of steps) {
    if (step.type === "anchor") {
      result.push({ index: offset++, label: undefined, type: step.type });
      continue;
    }
    const label = (step as any).label as string | undefined;
    result.push({ index: offset, label, type: step.type });
    offset++;

    // Recurse into sub-flows
    if (step.type === "loop") {
      const bodySteps: Step<any, any>[] = (step.body as any)?.steps ?? [];
      result.push(...collectSteps(bodySteps, offset));
      offset += bodySteps.length;
    } else if (step.type === "batch") {
      const procSteps: Step<any, any>[] = (step.processor as any)?.steps ?? [];
      result.push(...collectSteps(procSteps, offset));
      offset += procSteps.length;
    } else if (step.type === "branch") {
      // Branch arms are parallel alternatives — include them all
      const branches: Record<string, any> = (step as any).branches ?? {};
      // Arms are inline fns, not sub-flows, so we represent them as synthetic steps
      for (const [key, fn] of Object.entries(branches)) {
        result.push({
          index: offset,
          label: (fn as any)?.name || key,
          type: "fn",
        });
        offset++;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core audit logic
// ─────────────────────────────────────────────────────────────────────────────

function auditSteps(
  steps: Step<any, any>[],
  rules: TaintRule[],
): ComplianceReport {
  const flat = collectSteps(steps);
  const violations: ComplianceViolation[] = [];

  for (const rule of rules) {
    const sources: FlatStep[] = [];
    const sinks: FlatStep[] = [];

    for (const s of flat) {
      const meta: StepMeta = {
        index: s.index,
        type: s.type as StepMeta["type"],
        label: s.label,
      };
      if (matchesFilter(rule.source, meta)) sources.push(s);
      if (matchesFilter(rule.sink, meta)) sinks.push(s);
    }

    // A violation: any sink exists at a higher index than any source
    for (const source of sources) {
      for (const sink of sinks) {
        if (sink.index > source.index) {
          violations.push({
            rule,
            source: { index: source.index, label: source.label },
            sink: { index: sink.index, label: sink.label },
          });
        }
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Statically audit this flow for taint violations.
     *
     * Walks the step list without executing anything and checks that no "sink"
     * step (e.g. an outbound HTTP call) appears after a "source" step
     * (e.g. a PII-fetching step) for each supplied `TaintRule`.
     *
     * @returns A `ComplianceReport` with `passed` and any `violations` found.
     *
     * @example
     * const report = flow.auditFlow([{
     *   source: ["pii:fetchUser"],
     *   sink: (meta) => meta.label?.startsWith("external:") ?? false,
     *   message: "PII must not reach external endpoints",
     * }]);
     * if (!report.passed) throw new Error("Compliance check failed");
     */
    auditFlow(rules: TaintRule[]): ComplianceReport;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

export const withAuditFlow: FlowneerPlugin = {
  auditFlow(this: FlowBuilder<any, any>, rules: TaintRule[]): ComplianceReport {
    const steps: Step<any, any>[] = (this as any).steps ?? [];
    return auditSteps(steps, rules);
  },
};
