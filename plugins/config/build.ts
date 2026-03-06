// ---------------------------------------------------------------------------
// build — compile a FlowConfig into an executable FlowBuilder
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { StepConfig, FlowConfig, FnRegistry } from "./schema";
import { validate } from "./validate";

// ─────────────────────────────────────────────────────────────────────────────
// Custom step builder extension point
// ─────────────────────────────────────────────────────────────────────────────

export type CustomStepBuilder = (
  step: StepConfig & { type: string },
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
) => void;

const _customBuilders = new Map<string, CustomStepBuilder>();

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
// Internal recursive builder
// ─────────────────────────────────────────────────────────────────────────────

function applySteps(
  flow: FlowBuilder<any, any>,
  steps: StepConfig[],
  registry: FnRegistry,
  isFirst: boolean,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    switch (step.type) {
      case "fn": {
        const fn = registry[step.fn] as any;
        const opts = {
          ...(step.label !== undefined ? { label: step.label } : {}),
          ...(step.retries !== undefined ? { retries: step.retries } : {}),
          ...(step.delaySec !== undefined ? { delaySec: step.delaySec } : {}),
          ...(step.timeoutMs !== undefined
            ? { timeoutMs: step.timeoutMs }
            : {}),
        };
        if (i === 0 && isFirst) {
          flow.startWith(fn, opts);
        } else {
          flow.then(fn, opts);
        }
        break;
      }

      case "branch": {
        const router = registry[step.router] as any;
        const branches: Record<string, any> = {};
        for (const [key, ref] of Object.entries(step.branches)) {
          branches[key] = registry[ref];
        }
        const opts = {
          ...(step.label !== undefined ? { label: step.label } : {}),
          ...(step.retries !== undefined ? { retries: step.retries } : {}),
          ...(step.delaySec !== undefined ? { delaySec: step.delaySec } : {}),
          ...(step.timeoutMs !== undefined
            ? { timeoutMs: step.timeoutMs }
            : {}),
        };
        flow.branch(router, branches, opts);
        break;
      }

      case "loop": {
        const condition = registry[step.condition] as any;
        const body = step.body as StepConfig[];
        flow.loop(
          condition,
          (inner) => applySteps(inner as any, body, registry, true),
          {
            ...(step.label !== undefined ? { label: step.label } : {}),
          },
        );
        break;
      }

      case "batch": {
        const itemsFn = registry[step.items] as any;
        const processor = step.processor as StepConfig[];
        flow.batch(
          itemsFn,
          (inner) => applySteps(inner as any, processor, registry, true),
          {
            ...(step.key !== undefined ? { key: step.key } : {}),
            ...(step.label !== undefined ? { label: step.label } : {}),
          },
        );
        break;
      }

      case "parallel": {
        const fns = step.fns.map((ref) => registry[ref] as any);
        const opts = {
          ...(step.label !== undefined ? { label: step.label } : {}),
          ...(step.retries !== undefined ? { retries: step.retries } : {}),
          ...(step.delaySec !== undefined ? { delaySec: step.delaySec } : {}),
          ...(step.timeoutMs !== undefined
            ? { timeoutMs: step.timeoutMs }
            : {}),
        };
        flow.parallel(fns, opts);
        break;
      }

      case "anchor": {
        flow.anchor(step.name, step.maxVisits);
        break;
      }

      default: {
        const custom = _customBuilders.get((step as any).type);
        if (custom) {
          custom(step as any, flow, registry);
        }
        // Unknown types are silently skipped if no custom builder is registered —
        // validate() will have already caught this case before build() is called.
        break;
      }
    }
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
    return validate(config, registry, new Set(_customBuilders.keys()));
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
  ): FlowBuilder<S> {
    const result = validate(config, registry, new Set(_customBuilders.keys()));
    if (!result.valid) throw new ConfigValidationError(result.errors);

    const flow = new FlowBuilder<S>();
    applySteps(flow as any, config.steps, registry, true);
    return flow;
  }

  /**
   * Register a custom step type compiler.
   *
   * Called when `build()` encounters a step with an unknown `type`. The
   * builder is responsible for calling the appropriate `FlowBuilder` methods.
   *
   * @example
   * JsonFlowBuilder.registerStepBuilder("myStep", (step, flow, registry) => {
   *   flow.then(registry[step.fn], { label: step.label });
   * });
   */
  static registerStepBuilder(type: string, builder: CustomStepBuilder): void {
    _customBuilders.set(type, builder);
  }
}
