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
import type { Step } from "./steps";
import { FlowError, InterruptError } from "./errors";

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
    this.run(shared, params, options)
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
              // _retry calls the fn and returns the result. For async generator
              // fns the body has NOT run yet — generators are lazy; calling the
              // fn just constructs the iterator object.
              const result = await this._retry(
                this._res(step.retries, 1, shared, params),
                this._res(step.delaySec, 0, shared, params),
                () => step.fn(shared, params),
              );

              // Detect async (or sync) generators via their well-known symbol.
              // Using the symbol is more robust than instanceof checks and works
              // for any async iterable, not just native AsyncGenerators.
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
                let genResult = await gen.next();
                while (!genResult.done) {
                  (shared as any).__stream?.(genResult.value);
                  genResult = await gen.next();
                }
                if (
                  typeof genResult.value === "string" &&
                  genResult.value[0] === "#"
                )
                  gotoTarget = genResult.value.slice(1);
              } else if (typeof result === "string" && result[0] === "#") {
                gotoTarget = result.slice(1);
              }
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
