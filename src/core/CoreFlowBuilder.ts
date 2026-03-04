// ---------------------------------------------------------------------------
// Flowneer — CoreFlowBuilder (minimal, plugin-first base)
// ---------------------------------------------------------------------------
//
// This class contains only the orchestration engine:
//   • Hook registry & lifecycle
//   • A static step-type dispatch table (registerStepType)
//   • run() / stream() / _execute()
//
// No knowledge of specific step types lives here — those are registered
// as plugins via CoreFlowBuilder.registerStepType().
//
// ---------------------------------------------------------------------------

import type {
  FlowHooks,
  FlowneerPlugin,
  InstancePlugin,
  NumberOrFn,
  NodeOptions,
  RunOptions,
  StepMeta,
  StreamEvent,
} from "../types";
import type { AnchorStep, Step } from "../steps";
import { FlowError, InterruptError } from "../errors";
import { buildAnchorMap, resolveNumber, withTimeout } from "./utils";

// ---------------------------------------------------------------------------
// Hook cache
// ---------------------------------------------------------------------------

export type ResolvedHooks<S, P extends Record<string, unknown>> = {
  beforeFlow: NonNullable<FlowHooks<S, P>["beforeFlow"]>[];
  beforeStep: NonNullable<FlowHooks<S, P>["beforeStep"]>[];
  wrapStep: NonNullable<FlowHooks<S, P>["wrapStep"]>[];
  afterStep: NonNullable<FlowHooks<S, P>["afterStep"]>[];
  wrapParallelFn: NonNullable<FlowHooks<S, P>["wrapParallelFn"]>[];
  onError: NonNullable<FlowHooks<S, P>["onError"]>[];
  afterFlow: NonNullable<FlowHooks<S, P>["afterFlow"]>[];
};

function buildHookCache<S, P extends Record<string, unknown>>(
  list: FlowHooks<S, P>[],
): ResolvedHooks<S, P> {
  const pick = <K extends keyof FlowHooks<S, P>>(key: K) =>
    list.map((h) => h[key]).filter(Boolean) as NonNullable<
      FlowHooks<S, P>[K]
    >[];
  return {
    beforeFlow: pick("beforeFlow"),
    beforeStep: pick("beforeStep"),
    wrapStep: pick("wrapStep"),
    afterStep: pick("afterStep"),
    wrapParallelFn: pick("wrapParallelFn"),
    onError: pick("onError"),
    afterFlow: pick("afterFlow"),
  };
}

// ---------------------------------------------------------------------------
// Step handler context
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to every registered step handler.
 * Full access to the builder so handlers can run sub-flows etc.
 */
export interface StepContext<
  S,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  shared: S;
  params: P;
  signal?: AbortSignal;
  hooks: ResolvedHooks<S, P>;
  meta: StepMeta;
  builder: CoreFlowBuilder<S, P>;
}

/**
 * Signature for step type execution handlers registered via
 * `CoreFlowBuilder.registerStepType()`.
 *
 * Return a goto anchor name (without `#`) to jump, or `undefined` to continue.
 */
export type StepHandler = (
  step: any,
  ctx: StepContext<any, any>,
) => Promise<string | undefined>;

// ---------------------------------------------------------------------------
// CoreFlowBuilder
// ---------------------------------------------------------------------------

/**
 * Minimal orchestration engine. Knows nothing about specific step types —
 * those are registered as plugins via `CoreFlowBuilder.registerStepType()`.
 *
 * Use this as a base when you want a completely fresh, zero-assumption builder.
 * The exported `FlowBuilder` extends this with all primitive step types
 * (fn, branch, loop, batch, parallel, anchor) pre-registered.
 */
export class CoreFlowBuilder<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** @internal Ordered list of step descriptors. */
  steps: Step<S, P>[] = [];

  /** @internal Cached anchor-name → index map; null when stale. */
  protected _anchorMap: Map<string, number> | null = null;

  private _hooksList: FlowHooks<S, P>[] = [];
  private _hooksCache: ResolvedHooks<S, P> | null = null;

  // -------------------------------------------------------------------------
  // Step-type registry (static — shared across all instances)
  // -------------------------------------------------------------------------

  private static _stepHandlers = new Map<string, StepHandler>();

  /**
   * Register a handler for a custom step type.
   * Called once at module load time from each step plugin.
   *
   * @example
   * CoreFlowBuilder.registerStepType("myStep", async (step, ctx) => {
   *   await doWork(ctx.shared);
   *   return undefined;
   * });
   */
  static registerStepType(type: string, handler: StepHandler): void {
    CoreFlowBuilder._stepHandlers.set(type, handler);
  }

  // -------------------------------------------------------------------------
  // Hooks & plugins
  // -------------------------------------------------------------------------

  private _hooks(): ResolvedHooks<S, P> {
    return (this._hooksCache ??= buildHookCache(this._hooksList));
  }

  /**
   * Register lifecycle hooks (called by plugin methods, not by consumers).
   * Returns a dispose function that removes these hooks when called.
   */
  protected _setHooks(hooks: Partial<FlowHooks<S, P>>): () => void {
    this._hooksList.push(hooks);
    this._hooksCache = null;
    return () => {
      const idx = this._hooksList.indexOf(hooks);
      if (idx !== -1) this._hooksList.splice(idx, 1);
      this._hooksCache = null;
    };
  }

  /**
   * Register a plugin — copies its methods onto `FlowBuilder.prototype`.
   */
  static use(plugin: FlowneerPlugin): void {
    for (const [name, fn] of Object.entries(plugin)) {
      (CoreFlowBuilder.prototype as any)[name] = fn;
    }
  }

  /**
   * Apply one or more instance-scoped plugins to this builder.
   * Each plugin is called immediately; plugins are applied in array order
   * so the first plugin's hooks wrap the later ones.
   *
   * @example
   * const flow = new FlowBuilder<MyState>()
   *   .with([withTiming(), withRateLimit({ rps: 10 })])
   *   .then(myStep);
   */
  with(plugins: InstancePlugin<S, P> | Array<InstancePlugin<S, P>>): this {
    const list = Array.isArray(plugins) ? plugins : [plugins];
    for (const plugin of list) plugin(this as any);
    return this;
  }

  /**
   * Register lifecycle hooks directly on this instance.
   * Returns a dispose function that removes these hooks when called.
   */
  addHooks(hooks: Partial<FlowHooks<S, P>>): () => void {
    return this._setHooks(hooks);
  }

  // -------------------------------------------------------------------------
  // Execution API
  // -------------------------------------------------------------------------

  /** Execute the flow. */
  async run(shared: S, params?: P, options?: RunOptions): Promise<void> {
    const p = (params ?? {}) as P;
    const hooks = this._hooks();
    for (const h of hooks.beforeFlow) await h(shared, p);
    try {
      await this._execute(shared, p, options?.signal);
    } finally {
      for (const h of hooks.afterFlow) await h(shared, p);
    }
  }

  /**
   * Execute the flow and yield `StreamEvent`s as an async generator.
   */
  async *stream(
    shared: S,
    params?: P,
    options?: RunOptions,
  ): AsyncGenerator<StreamEvent<S>> {
    const queue: (StreamEvent<S> | null)[] = [];
    let notify: (() => void) | null = null;

    const push = (event: StreamEvent<S> | null) => {
      queue.push(event);
      notify?.();
      notify = null;
    };

    const drain = (): Promise<void> =>
      queue.length > 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            notify = r;
          });

    const disposeHooks = this._setHooks({
      beforeStep: (meta: StepMeta, _shared: S, _params: P) =>
        push({ type: "step:before", meta }),
      afterStep: (meta: StepMeta, s: S, _params: P) =>
        push({ type: "step:after", meta, shared: s }),
    });

    const prevStream = (shared as any).__stream;
    (shared as any).__stream = (chunk: unknown) => {
      push({ type: "chunk", data: chunk });
      if (typeof prevStream === "function") prevStream(chunk);
    };

    try {
      this.run(shared, params, options)
        .catch((err) => push({ type: "error", error: err }))
        .then(() => push(null));

      while (true) {
        await drain();
        while (queue.length > 0) {
          const event = queue.shift()!;
          if (event === null) {
            yield { type: "done" } as StreamEvent<S>;
            return;
          }
          yield event;
        }
      }
    } finally {
      disposeHooks();
      if (typeof prevStream === "function") {
        (shared as any).__stream = prevStream;
      } else {
        delete (shared as any).__stream;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal execution engine
  // -------------------------------------------------------------------------

  /** @internal Core execution loop, bypasses beforeFlow/afterFlow hooks. */
  async _execute(shared: S, params: P, signal?: AbortSignal): Promise<void> {
    const hooks = this._hooks();

    // Lazy anchor map — rebuilt only when _anchorMap is nulled by _pushStep
    if (this._anchorMap === null) {
      this._anchorMap = this.steps.some((s) => s.type === "anchor")
        ? buildAnchorMap(this.steps)
        : new Map<string, number>();
    }
    const labels = this._anchorMap;

    // Per-execution visit counter for anchors with maxVisits limits
    const visits = new Map<string, number>();

    for (let i = 0; i < this.steps.length; i++) {
      signal?.throwIfAborted();

      const step = this.steps[i]!;
      if (step.type === "anchor") continue; // pure marker — nothing to run

      const stepLabel = step.label;
      const meta: StepMeta = {
        index: i,
        type: step.type as StepMeta["type"],
        label: stepLabel,
      };

      try {
        for (const h of hooks.beforeStep) await h(meta, shared, params);

        const gotoTarget = await this._runStep(
          step as Step<S, P>,
          meta,
          shared,
          params,
          signal,
          hooks,
        );

        for (const h of hooks.afterStep) await h(meta, shared, params);

        if (gotoTarget !== undefined) {
          const target = labels.get(gotoTarget);
          if (target === undefined)
            throw new Error(`goto target anchor "${gotoTarget}" not found`);

          // Enforce per-anchor maxVisits if set
          const anchorStep = this.steps[target] as AnchorStep;
          if (anchorStep.maxVisits !== undefined) {
            const count = (visits.get(gotoTarget) ?? 0) + 1;
            visits.set(gotoTarget, count);
            if (count > anchorStep.maxVisits)
              throw new Error(
                `cycle limit exceeded for anchor "${gotoTarget}": ${count} visits > limit(${anchorStep.maxVisits})`,
              );
          }

          i = target; // loop increment will land on the step after the anchor
        }
      } catch (err) {
        if (err instanceof InterruptError) throw err;
        for (const h of hooks.onError) h(meta, err, shared, params);
        if (err instanceof FlowError) throw err;
        const labelPart = stepLabel ? `"${stepLabel}" ` : "";
        const label =
          step.type === "fn"
            ? `${labelPart}step ${i}`
            : `${labelPart}${step.type} (step ${i})`;
        throw new FlowError(label, err);
      }
    }
  }

  private async _runStep(
    step: Step<S, P>,
    meta: StepMeta,
    shared: S,
    params: P,
    signal: AbortSignal | undefined,
    hooks: ResolvedHooks<S, P>,
  ): Promise<string | undefined> {
    const handler = CoreFlowBuilder._stepHandlers.get(step.type);
    if (!handler) return undefined;

    const ctx: StepContext<S, P> = {
      shared,
      params,
      signal,
      hooks,
      meta,
      builder: this,
    };

    const timeoutMs = resolveNumber(
      (step as { timeoutMs?: NumberOrFn<S, P> }).timeoutMs,
      0,
      shared,
      params,
    );

    // Fast path: no wrappers, no timeout — call handler directly
    if (hooks.wrapStep.length === 0 && timeoutMs === 0) {
      return handler(step, ctx);
    }

    let gotoTarget: string | undefined;
    const execute = async () => {
      gotoTarget = await handler(step, ctx);
    };
    const baseExec =
      timeoutMs > 0 ? () => withTimeout(timeoutMs, execute) : execute;

    await hooks.wrapStep.reduceRight<() => Promise<void>>(
      (next, wrap) => () => wrap(meta, next, shared, params),
      baseExec,
    )();

    return gotoTarget;
  }

  /** @internal Run a sub-flow, wrapping errors with context. */
  async _runSub(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      return await fn();
    } catch (err) {
      throw new FlowError(label, err instanceof FlowError ? err.cause : err);
    }
  }

  /** @internal Resolve NodeOptions into their stored defaults. */
  _resolveOptions(options?: NodeOptions<S, P>) {
    return {
      retries: options?.retries ?? 1,
      delaySec: options?.delaySec ?? 0,
      timeoutMs: options?.timeoutMs ?? 0,
      label: options?.label,
    };
  }

  /** @internal Push a step and invalidate the anchor-map cache. */
  protected _pushStep(step: Step<S, P>): void {
    this.steps.push(step);
    this._anchorMap = null;
  }
}
