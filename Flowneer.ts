// ---------------------------------------------------------------------------
// Flowneer — a zero-dependency fluent flow builder
// ---------------------------------------------------------------------------

/**
 * Generic validator interface — structurally compatible with Zod, ArkType,
 * Valibot, or any custom implementation that exposes `.parse(input)`.
 * Used by `withStructuredOutput` and output parsers.
 */
export interface Validator<T = unknown> {
  parse(input: unknown): T;
}

/**
 * Events yielded by `FlowBuilder.stream()`.
 */
export type StreamEvent<S = any> =
  | { type: "step:before"; meta: StepMeta }
  | { type: "step:after"; meta: StepMeta; shared: S }
  | { type: "chunk"; data: unknown }
  | { type: "error"; error: unknown }
  | { type: "done" };

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

/**
 * A numeric value or a function that computes it from the current shared state
 * and params. Use functions for dynamic per-item behaviour, e.g.
 * `retries: (s) => (s.__batchItem % 3 === 0 ? 3 : 1)`.
 */
export type NumberOrFn<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> = number | ((shared: S, params: P) => number);

export interface NodeOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  retries?: NumberOrFn<S, P>;
  delaySec?: NumberOrFn<S, P>;
  timeoutMs?: NumberOrFn<S, P>;
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
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
}

interface BranchStep<S, P extends Record<string, unknown>> {
  type: "branch";
  router: NodeFn<S, P>;
  branches: Record<string, NodeFn<S, P>>;
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
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
  key: string;
}

interface ParallelStep<S, P extends Record<string, unknown>> {
  type: "parallel";
  fns: NodeFn<S, P>[];
  retries: NumberOrFn<S, P>;
  delaySec: NumberOrFn<S, P>;
  timeoutMs: NumberOrFn<S, P>;
  reducer?: (shared: S, drafts: S[]) => void;
}

interface AnchorStep {
  type: "anchor";
  name: string;
}

type Step<S, P extends Record<string, unknown>> =
  | FnStep<S, P>
  | BranchStep<S, P>
  | LoopStep<S, P>
  | BatchStep<S, P>
  | ParallelStep<S, P>
  | AnchorStep;

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

  /** Cached flat arrays of present hooks — invalidated whenever a hook is added. */
  private _cachedHooks: {
    beforeFlow: NonNullable<FlowHooks<S, P>["beforeFlow"]>[];
    beforeStep: NonNullable<FlowHooks<S, P>["beforeStep"]>[];
    wrapStep: NonNullable<FlowHooks<S, P>["wrapStep"]>[];
    afterStep: NonNullable<FlowHooks<S, P>["afterStep"]>[];
    wrapParallelFn: NonNullable<FlowHooks<S, P>["wrapParallelFn"]>[];
    onError: NonNullable<FlowHooks<S, P>["onError"]>[];
    afterFlow: NonNullable<FlowHooks<S, P>["afterFlow"]>[];
  } | null = null;

  private _getHooks() {
    if (this._cachedHooks) return this._cachedHooks;
    const hl = this._hooksList;
    this._cachedHooks = {
      beforeFlow: hl.map((h) => h.beforeFlow).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["beforeFlow"]
      >[],
      beforeStep: hl.map((h) => h.beforeStep).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["beforeStep"]
      >[],
      wrapStep: hl.map((h) => h.wrapStep).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["wrapStep"]
      >[],
      afterStep: hl.map((h) => h.afterStep).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["afterStep"]
      >[],
      wrapParallelFn: hl
        .map((h) => h.wrapParallelFn)
        .filter(Boolean) as NonNullable<FlowHooks<S, P>["wrapParallelFn"]>[],
      onError: hl.map((h) => h.onError).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["onError"]
      >[],
      afterFlow: hl.map((h) => h.afterFlow).filter(Boolean) as NonNullable<
        FlowHooks<S, P>["afterFlow"]
      >[],
    };
    return this._cachedHooks;
  }

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
    this._cachedHooks = null; // invalidate cache
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Set the first step, resetting any prior chain. */
  startWith(fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this {
    this.steps = [];
    return this._addFn(fn, options);
  }

  /** Append a sequential step. */
  then(fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this {
    return this._addFn(fn, options);
  }

  /**
   * Append a routing step.
   * `router` returns a key; the matching branch flow executes, then the chain continues.
   */
  branch(
    router: NodeFn<S, P>,
    branches: Record<string, NodeFn<S, P>>,
    options?: NodeOptions<S, P>,
  ): this {
    this.steps.push({
      type: "branch",
      router,
      branches,
      retries: options?.retries ?? 1,
      delaySec: options?.delaySec ?? 0,
      timeoutMs: options?.timeoutMs ?? 0,
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
   * Runs `processor` once per item extracted by `items`, setting
   * `shared[key]` each time (defaults to `"__batchItem"`).
   *
   * Use a unique `key` when nesting batches so each level has its own
   * namespace:
   * ```ts
   * .batch(s => s.users, b => b
   *   .startWith(s => { console.log(s.__batch_user); })
   *   .batch(s => s.__batch_user.posts, p => p
   *     .startWith(s => { console.log(s.__batch_post); })
   *   , { key: '__batch_post' })
   * , { key: '__batch_user' })
   * ```
   */
  batch(
    items: (shared: S, params: P) => Promise<any[]> | any[],
    processor: (b: FlowBuilder<S, P>) => void,
    options?: { key?: string },
  ): this {
    const inner = new FlowBuilder<S, P>();
    processor(inner);
    const key = options?.key ?? "__batchItem";
    this.steps.push({
      type: "batch",
      itemsExtractor: items,
      processor: inner,
      key,
    });
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
    options?: NodeOptions<S, P>,
    reducer?: (shared: S, drafts: S[]) => void,
  ): this {
    this.steps.push({
      type: "parallel",
      fns,
      retries: options?.retries ?? 1,
      delaySec: options?.delaySec ?? 0,
      timeoutMs: options?.timeoutMs ?? 0,
      reducer,
    });
    return this;
  }

  /**
   * Insert a named anchor. Anchors are no-op markers that can be jumped to
   * from any `NodeFn` by returning `"#anchorName"`.
   */
  anchor(name: string): this {
    this.steps.push({ type: "anchor", name });
    return this;
  }

  /** Execute the flow. */
  async run(shared: S, params?: P, options?: RunOptions): Promise<void> {
    const p = (params ?? {}) as P;
    const hooks = this._getHooks();
    for (const h of hooks.beforeFlow) await h(shared, p);
    try {
      await this._execute(shared, p, options?.signal);
    } finally {
      for (const h of hooks.afterFlow) await h(shared, p);
    }
  }

  /**
   * Execute the flow and yield `StreamEvent`s as an async generator.
   *
   * Events include `step:before`, `step:after`, `chunk` (from `emit()`),
   * `error`, and `done`. This is an additive API — `.run()` is unchanged.
   *
   * @example
   * for await (const event of flow.stream(shared)) {
   *   if (event.type === "chunk") process.stdout.write(event.data);
   * }
   */
  async *stream(
    shared: S,
    params?: P,
    options?: RunOptions,
  ): AsyncGenerator<StreamEvent<S>> {
    // Simple promise-based queue for bridging push (hooks) → pull (generator)
    type QueueItem = StreamEvent<S> | null; // null = sentinel for completion
    const queue: QueueItem[] = [];
    let resolve: (() => void) | null = null;

    const push = (event: QueueItem) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const pull = (): Promise<void> =>
      queue.length > 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            resolve = r;
          });

    // Inject stream hooks
    this._setHooks({
      beforeStep: (meta: StepMeta) => {
        push({ type: "step:before", meta });
      },
      afterStep: (meta: StepMeta, s: S) => {
        push({ type: "step:after", meta, shared: s });
      },
    });

    // Capture emit() calls by injecting __stream if not already set
    const prevStream = (shared as any).__stream;
    (shared as any).__stream = (chunk: unknown) => {
      push({ type: "chunk", data: chunk });
      if (typeof prevStream === "function") prevStream(chunk);
    };

    // Kick off the flow in the background
    const flowDone = this.run(shared, params, options)
      .catch((err) => push({ type: "error", error: err }))
      .then(() => push(null));

    // Yield events as they appear
    while (true) {
      await pull();
      while (queue.length > 0) {
        const event = queue.shift()!;
        if (event === null) {
          yield { type: "done" } as StreamEvent<S>;
          return;
        }
        yield event;
      }
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
    const hooks = this._getHooks();

    // Pre-scan anchors for goto support (skip when none present)
    const labels = new Map<string, number>();
    if (this.steps.some((s) => s.type === "anchor")) {
      for (let j = 0; j < this.steps.length; j++) {
        const s = this.steps[j]!;
        if (s.type === "anchor") labels.set(s.name, j);
      }
    }

    for (let i = 0; i < this.steps.length; i++) {
      signal?.throwIfAborted();
      const step = this.steps[i]!;

      // Anchors are pure markers — skip execution
      if (step.type === "anchor") continue;

      const meta: StepMeta = { index: i, type: step.type };
      try {
        for (const h of hooks.beforeStep) await h(meta, shared, params);

        let gotoTarget: string | undefined;

        const runBody = async () => {
          switch (step.type) {
            case "fn": {
              const result = await this._retry(
                this._res(step.retries, 1, shared, params),
                this._res(step.delaySec, 0, shared, params),
                () => step.fn(shared, params),
              );
              if (typeof result === "string" && result[0] === "#")
                gotoTarget = result.slice(1);
              break;
            }

            case "branch": {
              const bRetries = this._res(step.retries, 1, shared, params);
              const bDelay = this._res(step.delaySec, 0, shared, params);
              const action = await this._retry(bRetries, bDelay, () =>
                step.router(shared, params),
              );
              const key = action ? String(action) : "default";
              const fn = step.branches[key] ?? step.branches["default"];
              if (fn) {
                const branchResult = await this._retry(bRetries, bDelay, () =>
                  fn(shared, params),
                );
                if (typeof branchResult === "string" && branchResult[0] === "#")
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
              const k = step.key;
              const prev = (shared as any)[k];
              const hadKey = Object.prototype.hasOwnProperty.call(shared, k);
              const list = await step.itemsExtractor(shared, params);
              for (const item of list) {
                (shared as any)[k] = item;
                await this._runSub(`batch (step ${i})`, () =>
                  step.processor._execute(shared, params, signal),
                );
              }
              if (!hadKey) delete (shared as any)[k];
              else (shared as any)[k] = prev;
              break;
            }

            case "parallel": {
              const pfnWrappers = hooks.wrapParallelFn;
              const pRetries = this._res(step.retries, 1, shared, params);
              const pDelay = this._res(step.delaySec, 0, shared, params);

              if (step.reducer) {
                // Safe mode: each fn gets its own shallow draft
                const drafts: S[] = [];
                await Promise.all(
                  step.fns.map(async (fn, fi) => {
                    const draft = { ...shared } as S;
                    drafts[fi] = draft;
                    const exec = () =>
                      this._retry(pRetries, pDelay, () => fn(draft, params));
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
                      this._retry(pRetries, pDelay, () => fn(shared, params));
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

        const rawTimeout = (step as { timeoutMs?: NumberOrFn<S, P> }).timeoutMs;
        const resolvedTimeout = this._res(rawTimeout, 0, shared, params);
        const baseExec = (): Promise<void> =>
          resolvedTimeout > 0
            ? this._withTimeout(resolvedTimeout, runBody)
            : runBody();

        const wrappers = hooks.wrapStep;
        const wrapped = wrappers.reduceRight<() => Promise<void>>(
          (next, wrap) => () => wrap(meta, next, shared, params),
          baseExec,
        );
        await wrapped();

        for (const h of hooks.afterStep) await h(meta, shared, params);

        // Handle goto: jump to a labelled step
        if (gotoTarget) {
          const target = labels.get(gotoTarget);
          if (target === undefined)
            throw new Error(`goto target anchor "${gotoTarget}" not found`);
          i = target; // for-loop will i++ → first step after the anchor
        }
      } catch (err) {
        if (err instanceof InterruptError) throw err;
        for (const h of hooks.onError) h(meta, err, shared, params);
        if (err instanceof FlowError) throw err;
        const stepLabel =
          step.type === "fn" ? `step ${i}` : `${step.type} (step ${i})`;
        throw new FlowError(stepLabel, err);
      }
    }
  }

  private _addFn(fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this {
    this.steps.push({
      type: "fn",
      fn,
      retries: options?.retries ?? 1,
      delaySec: options?.delaySec ?? 0,
      timeoutMs: options?.timeoutMs ?? 0,
    });
    return this;
  }

  /** Resolve a NumberOrFn value against the current shared state and params. */
  private _res(
    val: NumberOrFn<S, P> | undefined,
    def: number,
    shared: S,
    params: P,
  ): number {
    if (val === undefined) return def;
    return typeof val === "function" ? val(shared, params) : val;
  }

  private async _runSub(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      return await fn();
    } catch (err) {
      throw new FlowError(label, err instanceof FlowError ? err.cause : err);
    }
  }

  private async _retry(
    times: number,
    delaySec: number,
    fn: () => Promise<any> | any,
  ): Promise<any> {
    if (times === 1) return fn(); // fast path — no retry overhead
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
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      fn().finally(() => clearTimeout(timer)),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`step timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  }
}
