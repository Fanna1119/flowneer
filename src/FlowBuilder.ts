// ---------------------------------------------------------------------------
// Flowneer — FlowBuilder class
// ---------------------------------------------------------------------------

import type {
  FlowHooks,
  FlowneerPlugin,
  NodeFn,
  NodeOptions,
  NumberOrFn,
  RunOptions,
  StepMeta,
  StreamEvent,
} from "./types";
import type { ParallelStep, Step } from "./steps";
import { FlowError, InterruptError } from "./errors";

// ---------------------------------------------------------------------------
// Hook cache
// ---------------------------------------------------------------------------

type ResolvedHooks<S, P extends Record<string, unknown>> = {
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
// Pure utility functions
// ---------------------------------------------------------------------------

function resolveNumber<S, P extends Record<string, unknown>>(
  val: NumberOrFn<S, P> | undefined,
  fallback: number,
  shared: S,
  params: P,
): number {
  if (val === undefined) return fallback;
  return typeof val === "function" ? val(shared, params) : val;
}

async function retry<T>(
  times: number,
  delaySec: number,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (times === 1) return fn(); // fast path
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

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
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

// ---------------------------------------------------------------------------
// Fn-step helpers
// ---------------------------------------------------------------------------

function isAnchorTarget(value: unknown): value is string {
  return typeof value === "string" && value[0] === "#";
}

/**
 * Drive a fn step's result to completion.
 *
 * - If the result is an async generator, iterates it manually so each yielded
 *   value is forwarded to `__stream` and the final return value can route.
 * - Otherwise treats a `"#anchor"` string return as a goto target.
 *
 * Returns the anchor name (without `#`) to jump to, or `undefined`.
 */
async function runFnResult<S>(
  result: unknown,
  shared: S,
): Promise<string | undefined> {
  if (
    result != null &&
    typeof (result as any)[Symbol.asyncIterator] === "function"
  ) {
    // Manually drive the generator so we can:
    //   • forward each yielded value to __stream as a chunk
    //   • capture the final return value for #anchor routing
    // (for…of discards the return value, so we call .next() directly)
    const gen = result as AsyncGenerator<
      unknown,
      string | undefined | void,
      unknown
    >;
    let next = await gen.next();
    while (!next.done) {
      (shared as any).__stream?.(next.value);
      next = await gen.next();
    }
    return isAnchorTarget(next.value) ? next.value.slice(1) : undefined;
  }
  return isAnchorTarget(result) ? result.slice(1) : undefined;
}

function buildAnchorMap<S, P extends Record<string, unknown>>(
  steps: Step<S, P>[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.type === "anchor") map.set(s.name, i);
  }
  return map;
}

// ---------------------------------------------------------------------------
// FlowBuilder
// ---------------------------------------------------------------------------

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
  protected steps: Step<S, P>[] = [];

  private _hooksList: FlowHooks<S, P>[] = [];
  private _hooksCache: ResolvedHooks<S, P> | null = null;

  // -------------------------------------------------------------------------
  // Hooks & plugins
  // -------------------------------------------------------------------------

  private _hooks(): ResolvedHooks<S, P> {
    return (this._hooksCache ??= buildHookCache(this._hooksList));
  }

  /** Register lifecycle hooks (called by plugin methods, not by consumers). */
  protected _setHooks(hooks: Partial<FlowHooks<S, P>>): void {
    this._hooksList.push(hooks);
    this._hooksCache = null;
  }

  /** Register a plugin — copies its methods onto `FlowBuilder.prototype`. */
  static use(plugin: FlowneerPlugin): void {
    for (const [name, fn] of Object.entries(plugin)) {
      (FlowBuilder.prototype as any)[name] = fn;
    }
  }

  // -------------------------------------------------------------------------
  // Builder API
  // -------------------------------------------------------------------------

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
   * Splice all steps from a `Fragment` into this flow at the current position.
   *
   * Fragments are reusable partial flows created with the `fragment()` factory.
   * Steps are copied by reference (same semantics as `loop` / `batch` inners).
   *
   * @example
   * ```ts
   * const enrich = fragment<S>()
   *   .then(fetchUser)
   *   .then(enrichProfile);
   *
   * new FlowBuilder<S>()
   *   .then(init)
   *   .add(enrich)
   *   .then(finalize)
   *   .run(shared);
   * ```
   */
  add(frag: FlowBuilder<S, P>): this {
    for (const step of frag.steps) this.steps.push(step);
    return this;
  }

  /**
   * Append a routing step.
   * `router` returns a key; the matching branch executes, then the chain continues.
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
    this.steps.push({
      type: "batch",
      itemsExtractor: items,
      processor: inner,
      key: options?.key ?? "__batchItem",
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
    // Promise-based queue for bridging push (hooks) → pull (generator)
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

    // Wire beforeStep / afterStep into the event queue
    this._setHooks({
      beforeStep: (meta: StepMeta) => push({ type: "step:before", meta }),
      afterStep: (meta: StepMeta, s: S) =>
        push({ type: "step:after", meta, shared: s }),
    });

    // Forward __stream (emit) calls into the queue
    const prevStream = (shared as any).__stream;
    (shared as any).__stream = (chunk: unknown) => {
      push({ type: "chunk", data: chunk });
      if (typeof prevStream === "function") prevStream(chunk);
    };

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
  }

  // -------------------------------------------------------------------------
  // Internal execution engine
  // -------------------------------------------------------------------------

  protected async _execute(
    shared: S,
    params: P,
    signal?: AbortSignal,
  ): Promise<void> {
    const hooks = this._hooks();
    const hasAnchors = this.steps.some((s) => s.type === "anchor");
    const labels = hasAnchors
      ? buildAnchorMap(this.steps)
      : new Map<string, number>();

    for (let i = 0; i < this.steps.length; i++) {
      signal?.throwIfAborted();

      const step = this.steps[i]!;
      if (step.type === "anchor") continue; // pure marker — nothing to run

      const meta: StepMeta = { index: i, type: step.type };

      try {
        for (const h of hooks.beforeStep) await h(meta, shared, params);

        const gotoTarget = await this._runStep(
          step,
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
          i = target; // loop increment will land on the step after the anchor
        }
      } catch (err) {
        if (err instanceof InterruptError) throw err;
        for (const h of hooks.onError) h(meta, err, shared, params);
        if (err instanceof FlowError) throw err;
        const label =
          step.type === "fn" ? `step ${i}` : `${step.type} (step ${i})`;
        throw new FlowError(label, err);
      }
    }
  }

  /**
   * Apply timeout and `wrapStep` middleware around a single step, then
   * delegate to `_dispatchStep`. Returns an anchor target if the step
   * issued a goto, otherwise `undefined`.
   */
  private async _runStep(
    step: Step<S, P>,
    meta: StepMeta,
    shared: S,
    params: P,
    signal: AbortSignal | undefined,
    hooks: ResolvedHooks<S, P>,
  ): Promise<string | undefined> {
    let gotoTarget: string | undefined;

    const execute = async () => {
      gotoTarget = await this._dispatchStep(
        step,
        meta,
        shared,
        params,
        signal,
        hooks,
      );
    };

    const timeoutMs = resolveNumber(
      (step as { timeoutMs?: NumberOrFn<S, P> }).timeoutMs,
      0,
      shared,
      params,
    );
    const baseExec =
      timeoutMs > 0 ? () => withTimeout(timeoutMs, execute) : execute;

    const wrapped = hooks.wrapStep.reduceRight<() => Promise<void>>(
      (next, wrap) => () => wrap(meta, next, shared, params),
      baseExec,
    );
    await wrapped();

    return gotoTarget;
  }

  /**
   * Pure step dispatch — no timeout, no `wrapStep`. Returns goto target if any.
   */
  private async _dispatchStep(
    step: Step<S, P>,
    meta: StepMeta,
    shared: S,
    params: P,
    signal: AbortSignal | undefined,
    hooks: ResolvedHooks<S, P>,
  ): Promise<string | undefined> {
    switch (step.type) {
      case "fn": {
        const result = await retry(
          resolveNumber(step.retries, 1, shared, params),
          resolveNumber(step.delaySec, 0, shared, params),
          () => step.fn(shared, params),
        );
        return runFnResult(result, shared);
      }

      case "branch": {
        const r = resolveNumber(step.retries, 1, shared, params);
        const d = resolveNumber(step.delaySec, 0, shared, params);
        const action = await retry(r, d, () => step.router(shared, params));
        const key = action ? String(action) : "default";
        const fn = step.branches[key] ?? step.branches["default"];
        if (fn) {
          const result = await retry(r, d, () => fn(shared, params));
          if (isAnchorTarget(result)) return result.slice(1);
        }
        return undefined;
      }

      case "loop": {
        while (await step.condition(shared, params))
          await this._runSub(`loop (step ${meta.index})`, () =>
            step.body._execute(shared, params, signal),
          );
        return undefined;
      }

      case "batch": {
        const { key, itemsExtractor, processor } = step;
        const prev = (shared as any)[key];
        const hadKey = Object.prototype.hasOwnProperty.call(shared, key);
        const list = await itemsExtractor(shared, params);
        for (const item of list) {
          (shared as any)[key] = item;
          await this._runSub(`batch (step ${meta.index})`, () =>
            processor._execute(shared, params, signal),
          );
        }
        if (!hadKey) delete (shared as any)[key];
        else (shared as any)[key] = prev;
        return undefined;
      }

      case "parallel": {
        await this._runParallel(step, meta, shared, params, hooks);
        return undefined;
      }
    }
  }

  private async _runParallel(
    step: ParallelStep<S, P>,
    meta: StepMeta,
    shared: S,
    params: P,
    hooks: ResolvedHooks<S, P>,
  ): Promise<void> {
    const r = resolveNumber(step.retries, 1, shared, params);
    const d = resolveNumber(step.delaySec, 0, shared, params);
    const wrappers = hooks.wrapParallelFn;

    const runFn = (fn: NodeFn<S, P>, s: S, fi: number): Promise<void> => {
      const exec = async () => {
        await retry(r, d, () => fn(s, params));
      };
      return wrappers.reduceRight<() => Promise<void>>(
        (next, wrap) => () => wrap(meta, fi, next, s, params),
        exec,
      )();
    };

    if (step.reducer) {
      // Safe mode: each fn gets its own shallow draft
      const drafts = step.fns.map(() => ({ ...shared }) as S);
      await Promise.all(step.fns.map((fn, fi) => runFn(fn, drafts[fi]!, fi)));
      step.reducer(shared, drafts);
    } else {
      // Direct shared mutation
      await Promise.all(step.fns.map((fn, fi) => runFn(fn, shared, fi)));
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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

  private async _runSub(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      return await fn();
    } catch (err) {
      throw new FlowError(label, err instanceof FlowError ? err.cause : err);
    }
  }
}
