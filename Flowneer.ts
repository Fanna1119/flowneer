// ---------------------------------------------------------------------------
// Flowneer — a zero-dependency fluent flow builder
// ---------------------------------------------------------------------------

/**
 * Function signature for all step logic.
 * Return an action string to route, or undefined/void to continue.
 */
export type NodeFn<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> = (
  shared: S,
  params: P,
) => Promise<string | undefined | void> | string | undefined | void;

export interface NodeOptions {
  retries?: number;
  delaySec?: number;
  timeoutMs?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
}

// ───────────────────────────────────────────────────────────────────────────
// Internal step representation
// ───────────────────────────────────────────────────────────────────────────

interface FnStep<S, P extends Record<string, unknown>> {
  type: "fn";
  fn: NodeFn<S, P>;
  retries: number;
  delaySec: number;
  timeoutMs: number;
}

interface BranchStep<S, P extends Record<string, unknown>> {
  type: "branch";
  router: NodeFn<S, P>;
  branches: Record<string, NodeFn<S, P>>;
  retries: number;
  delaySec: number;
  timeoutMs: number;
}

interface LoopStep<S, P extends Record<string, unknown>> {
  type: "loop";
  condition: (shared: S, params: P) => Promise<boolean> | boolean;
  body: FlowBuilder<S, P>;
}

interface BatchStep<S, P extends Record<string, unknown>> {
  type: "batch";
  itemsExtractor: (shared: S, params: P) => Promise<any[]> | any[];
  processor: FlowBuilder<S, P>;
}

interface ParallelStep<S, P extends Record<string, unknown>> {
  type: "parallel";
  fns: NodeFn<S, P>[];
  retries: number;
  delaySec: number;
  timeoutMs: number;
  reducer?: (shared: S, drafts: S[]) => void;
}

interface LabelStep {
  type: "label";
  name: string;
}

type Step<S, P extends Record<string, unknown>> =
  | FnStep<S, P>
  | BranchStep<S, P>
  | LoopStep<S, P>
  | BatchStep<S, P>
  | ParallelStep<S, P>
  | LabelStep;

// ───────────────────────────────────────────────────────────────────────────
// Plugin system
// ───────────────────────────────────────────────────────────────────────────

/** Metadata exposed to hooks — intentionally minimal to avoid coupling. */
export interface StepMeta {
  index: number;
  type: Step<any, any>["type"];
  label?: string;
}

/** Lifecycle hooks that plugins can register. */
export interface FlowHooks<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Fires once before the first step runs. */
  beforeFlow?: (shared: S, params: P) => void | Promise<void>;
  beforeStep?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  /**
   * Wraps step execution — call `next()` to invoke the step body.
   * Omitting `next()` skips execution (dry-run, mock, etc.).
   * Multiple `wrapStep` registrations are composed innermost-first.
   */
  wrapStep?: (
    meta: StepMeta,
    next: () => Promise<void>,
    shared: S,
    params: P,
  ) => Promise<void>;
  afterStep?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  /**
   * Wraps individual functions within a `.parallel()` step.
   * `fnIndex` is the position within the fns array.
   */
  wrapParallelFn?: (
    meta: StepMeta,
    fnIndex: number,
    next: () => Promise<void>,
    shared: S,
    params: P,
  ) => Promise<void>;
  onError?: (meta: StepMeta, error: unknown, shared: S, params: P) => void;
  afterFlow?: (shared: S, params: P) => void | Promise<void>;
}

/**
 * A plugin is an object whose keys become methods on `FlowBuilder.prototype`.
 * Each method receives the builder as `this` and should return `this` for chaining.
 *
 * Use declaration merging to get type-safe access:
 * ```ts
 * declare module "flowneer" {
 *   interface FlowBuilder<S, P> { withTracing(fn: TraceCallback): this; }
 * }
 * ```
 */
export type FlowneerPlugin = Record<
  string,
  (this: FlowBuilder<any, any>, ...args: any[]) => any
>;

// ═══════════════════════════════════════════════════════════════════════════
// FlowError
// ═══════════════════════════════════════════════════════════════════════════

/** Wraps step failures with context about which step failed. */
export class FlowError extends Error {
  readonly step: string;
  override readonly cause: unknown;

  constructor(step: string, cause: unknown) {
    super(
      `Flow failed at ${step}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "FlowError";
    this.step = step;
    this.cause = cause;
  }
}

/**
 * Thrown by `interruptIf` to pause a flow.
 * Catch this in your runner to save `savedShared` and resume later.
 */
export class InterruptError extends Error {
  readonly savedShared: unknown;

  constructor(shared: unknown) {
    super("Flow interrupted");
    this.name = "InterruptError";
    this.savedShared = shared;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FlowBuilder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fluent builder for composable flows.
 *
 * Steps execute sequentially in the order added. Call `.run(shared)` to execute.
 *
 * **Shared-state safety**: all steps operate on the same shared object.
 * Mutate it directly; avoid spreading/replacing the entire object.
 */
export class FlowBuilder<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  private steps: Step<S, P>[] = [];
  private _hooksList: FlowHooks<S, P>[] = [];

  // -----------------------------------------------------------------------
  // Plugin registration
  // -----------------------------------------------------------------------

  /** Register a plugin — copies its methods onto `FlowBuilder.prototype`. */
  static use(plugin: FlowneerPlugin): void {
    for (const [name, fn] of Object.entries(plugin)) {
      (FlowBuilder.prototype as any)[name] = fn;
    }
  }

  /** Register lifecycle hooks (called by plugin methods, not by consumers). */
  protected _setHooks(hooks: Partial<FlowHooks<S, P>>): void {
    this._hooksList.push(hooks);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Set the first step, resetting any prior chain. */
  startWith(fn: NodeFn<S, P>, options?: NodeOptions): this {
    this.steps = [];
    return this._addFn(fn, options);
  }

  /** Append a sequential step. */
  then(fn: NodeFn<S, P>, options?: NodeOptions): this {
    return this._addFn(fn, options);
  }

  /**
   * Append a routing step.
   * `router` returns a key; the matching branch flow executes, then the chain continues.
   */
  branch(
    router: NodeFn<S, P>,
    branches: Record<string, NodeFn<S, P>>,
    options?: NodeOptions,
  ): this {
    const { retries = 1, delaySec = 0, timeoutMs = 0 } = options ?? {};
    this.steps.push({
      type: "branch",
      router,
      branches,
      retries,
      delaySec,
      timeoutMs,
    });
    return this;
  }

  /**
   * Append a looping step.
   * Repeatedly runs `body` while `condition` returns true.
   */
  loop(
    condition: (shared: S, params: P) => Promise<boolean> | boolean,
    body: (b: FlowBuilder<S, P>) => void,
  ): this {
    const inner = new FlowBuilder<S, P>();
    body(inner);
    this.steps.push({ type: "loop", condition, body: inner });
    return this;
  }

  /**
   * Append a batch step.
   * Runs `processor` once per item extracted by `items`, setting `shared.__batchItem` each time.
   */
  batch(
    items: (shared: S, params: P) => Promise<any[]> | any[],
    processor: (b: FlowBuilder<S, P>) => void,
  ): this {
    const inner = new FlowBuilder<S, P>();
    processor(inner);
    this.steps.push({ type: "batch", itemsExtractor: items, processor: inner });
    return this;
  }

  /**
   * Append a parallel step.
   * Runs all `fns` concurrently against the same shared state.
   *
   * When `reducer` is provided each fn receives its own shallow clone of
   * `shared`; after all fns complete the reducer merges the drafts back
   * into the original shared object — preventing concurrent mutation races.
   */
  parallel(
    fns: NodeFn<S, P>[],
    options?: NodeOptions,
    reducer?: (shared: S, drafts: S[]) => void,
  ): this {
    const { retries = 1, delaySec = 0, timeoutMs = 0 } = options ?? {};
    this.steps.push({
      type: "parallel",
      fns,
      retries,
      delaySec,
      timeoutMs,
      reducer,
    });
    return this;
  }

  /**
   * Insert a named label. Labels are no-op markers that can be jumped to
   * from any `NodeFn` by returning `"→labelName"`.
   */
  label(name: string): this {
    this.steps.push({ type: "label", name });
    return this;
  }

  /** Execute the flow. */
  async run(shared: S, params?: P, options?: RunOptions): Promise<void> {
    const p = (params ?? {}) as P;
    for (const h of this._hooksList) await h.beforeFlow?.(shared, p);
    try {
      await this._execute(shared, p, options?.signal);
    } finally {
      for (const h of this._hooksList) await h.afterFlow?.(shared, p);
    }
  }

  // -----------------------------------------------------------------------
  // Internal execution
  // -----------------------------------------------------------------------

  protected async _execute(
    shared: S,
    params: P,
    signal?: AbortSignal,
  ): Promise<void> {
    // Pre-scan labels for goto support
    const labels = new Map<string, number>();
    for (let j = 0; j < this.steps.length; j++) {
      const s = this.steps[j]!;
      if (s.type === "label") labels.set(s.name, j);
    }

    for (let i = 0; i < this.steps.length; i++) {
      signal?.throwIfAborted();
      const step = this.steps[i]!;

      // Labels are pure markers — skip execution
      if (step.type === "label") continue;

      const meta: StepMeta = { index: i, type: step.type };
      try {
        for (const h of this._hooksList)
          await h.beforeStep?.(meta, shared, params);

        let gotoTarget: string | undefined;

        const runBody = async () => {
          switch (step.type) {
            case "fn": {
              const result = await this._retry(
                step.retries,
                step.delaySec,
                () => step.fn(shared, params),
              );
              if (typeof result === "string" && result.startsWith("→"))
                gotoTarget = result.slice(1);
              break;
            }

            case "branch": {
              const action = await this._retry(
                step.retries,
                step.delaySec,
                () => step.router(shared, params),
              );
              const key = action ? String(action) : "default";
              const fn = step.branches[key] ?? step.branches["default"];
              if (fn) {
                const branchResult = await this._retry(
                  step.retries,
                  step.delaySec,
                  () => fn(shared, params),
                );
                if (
                  typeof branchResult === "string" &&
                  branchResult.startsWith("→")
                )
                  gotoTarget = branchResult.slice(1);
              }
              break;
            }

            case "loop":
              while (await step.condition(shared, params))
                await this._runSub(`loop (step ${i})`, () =>
                  step.body._execute(shared, params, signal),
                );
              break;

            case "batch": {
              const prev = (shared as any).__batchItem;
              const list = await step.itemsExtractor(shared, params);
              for (const item of list) {
                (shared as any).__batchItem = item;
                await this._runSub(`batch (step ${i})`, () =>
                  step.processor._execute(shared, params, signal),
                );
              }
              if (prev === undefined) delete (shared as any).__batchItem;
              else (shared as any).__batchItem = prev;
              break;
            }

            case "parallel": {
              const pfnWrappers = this._hooksList
                .map((h) => h.wrapParallelFn)
                .filter((w): w is NonNullable<typeof w> => w != null);

              if (step.reducer) {
                // Safe mode: each fn gets its own shallow draft
                const drafts: S[] = [];
                await Promise.all(
                  step.fns.map(async (fn, fi) => {
                    const draft = { ...shared } as S;
                    drafts[fi] = draft;
                    const exec = () =>
                      this._retry(step.retries, step.delaySec, () =>
                        fn(draft, params),
                      );
                    const wrapped = pfnWrappers.reduceRight<
                      () => Promise<void>
                    >(
                      (next, wrap) => () => wrap(meta, fi, next, draft, params),
                      async () => {
                        await exec();
                      },
                    );
                    await wrapped();
                  }),
                );
                step.reducer(shared, drafts);
              } else {
                // Original mode: direct shared mutation
                await Promise.all(
                  step.fns.map((fn, fi) => {
                    const exec = () =>
                      this._retry(step.retries, step.delaySec, () =>
                        fn(shared, params),
                      );
                    const wrapped = pfnWrappers.reduceRight<
                      () => Promise<void>
                    >(
                      (next, wrap) => () =>
                        wrap(meta, fi, next, shared, params),
                      async () => {
                        await exec();
                      },
                    );
                    return wrapped();
                  }),
                );
              }
              break;
            }
          }
        };

        const { timeoutMs } = step as { timeoutMs?: number };
        const baseExec = (): Promise<void> =>
          timeoutMs! > 0 ? this._withTimeout(timeoutMs!, runBody) : runBody();

        const wrappers = this._hooksList
          .map((h) => h.wrapStep)
          .filter((w): w is NonNullable<typeof w> => w != null);
        const wrapped = wrappers.reduceRight<() => Promise<void>>(
          (next, wrap) => () => wrap(meta, next, shared, params),
          baseExec,
        );
        await wrapped();

        for (const h of this._hooksList)
          await h.afterStep?.(meta, shared, params);

        // Handle goto: jump to a labelled step
        if (gotoTarget) {
          const target = labels.get(gotoTarget);
          if (target === undefined)
            throw new Error(`goto target label "${gotoTarget}" not found`);
          i = target; // for-loop will i++ → first step after the label
        }
      } catch (err) {
        if (err instanceof InterruptError) throw err;
        for (const h of this._hooksList) h.onError?.(meta, err, shared, params);
        if (err instanceof FlowError) throw err;
        const stepLabel =
          step.type === "fn" ? `step ${i}` : `${step.type} (step ${i})`;
        throw new FlowError(stepLabel, err);
      }
    }
  }

  private _addFn(fn: NodeFn<S, P>, options?: NodeOptions): this {
    const { retries = 1, delaySec = 0, timeoutMs = 0 } = options ?? {};
    this.steps.push({ type: "fn", fn, retries, delaySec, timeoutMs });
    return this;
  }

  private _runSub(label: string, fn: () => Promise<void>): Promise<void> {
    return fn().catch((err) => {
      throw new FlowError(label, err instanceof FlowError ? err.cause : err);
    });
  }

  private async _retry(
    times: number,
    delaySec: number,
    fn: () => Promise<any> | any,
  ): Promise<any> {
    while (true) {
      try {
        return await fn();
      } catch (err) {
        if (!--times) throw err;
        if (delaySec > 0)
          await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }
  }

  private _withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`step timed out after ${ms}ms`)), ms),
      ),
    ]);
  }
}
