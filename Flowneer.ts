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
}

// ───────────────────────────────────────────────────────────────────────────
// Internal step representation
// ───────────────────────────────────────────────────────────────────────────

interface FnStep<S, P extends Record<string, unknown>> {
  type: "fn";
  fn: NodeFn<S, P>;
  retries: number;
  delaySec: number;
}

interface BranchStep<S, P extends Record<string, unknown>> {
  type: "branch";
  router: NodeFn<S, P>;
  branches: Record<string, NodeFn<S, P>>;
  retries: number;
  delaySec: number;
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
}

type Step<S, P extends Record<string, unknown>> =
  | FnStep<S, P>
  | BranchStep<S, P>
  | LoopStep<S, P>
  | BatchStep<S, P>
  | ParallelStep<S, P>;

// ═══════════════════════════════════════════════════════════════════════════
// FlowError
// ═══════════════════════════════════════════════════════════════════════════

/** Wraps step failures with context about which step failed. */
export class FlowError extends Error {
  readonly step: string;
  override readonly cause: unknown;

  constructor(step: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Flow failed at ${step}: ${msg}`);
    this.name = "FlowError";
    this.step = step;
    this.cause = cause;
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
    const { retries = 1, delaySec = 0 } = options ?? {};
    this.steps.push({ type: "branch", router, branches, retries, delaySec });
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
   */
  parallel(fns: NodeFn<S, P>[], options?: NodeOptions): this {
    const { retries = 1, delaySec = 0 } = options ?? {};
    this.steps.push({ type: "parallel", fns, retries, delaySec });
    return this;
  }

  /** Execute the flow. */
  async run(shared: S, params?: P): Promise<void> {
    await this._execute(shared, (params ?? {}) as P);
  }

  // -----------------------------------------------------------------------
  // Internal execution
  // -----------------------------------------------------------------------

  protected async _execute(shared: S, params: P): Promise<void> {
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      try {
        switch (step.type) {
          case "fn":
            await this._retry(step.retries, step.delaySec, () =>
              step.fn(shared, params),
            );
            break;

          case "branch": {
            const action = await this._retry(step.retries, step.delaySec, () =>
              step.router(shared, params),
            );
            const key = action ? String(action) : "default";
            const fn = step.branches[key] ?? step.branches["default"];
            if (fn)
              await this._retry(step.retries, step.delaySec, () =>
                fn(shared, params),
              );
            break;
          }

          case "loop":
            while (await step.condition(shared, params)) {
              try {
                await step.body._execute(shared, params);
              } catch (err) {
                const cause = err instanceof FlowError ? err.cause : err;
                throw new FlowError(`loop (step ${i})`, cause);
              }
            }
            break;

          case "batch": {
            const prev = (shared as any).__batchItem;
            const list = await step.itemsExtractor(shared, params);
            for (const item of list) {
              (shared as any).__batchItem = item;
              try {
                await step.processor._execute(shared, params);
              } catch (err) {
                const cause = err instanceof FlowError ? err.cause : err;
                throw new FlowError(`batch (step ${i})`, cause);
              }
            }
            if (prev === undefined) delete (shared as any).__batchItem;
            else (shared as any).__batchItem = prev;
            break;
          }

          case "parallel":
            await Promise.all(
              step.fns.map((fn) =>
                this._retry(step.retries, step.delaySec, () =>
                  fn(shared, params),
                ),
              ),
            );
            break;
        }
      } catch (err) {
        if (err instanceof FlowError) throw err;
        const label =
          step.type === "fn" ? `step ${i}` : `${step.type} (step ${i})`;
        throw new FlowError(label, err);
      }
    }
  }

  private _addFn(fn: NodeFn<S, P>, options?: NodeOptions): this {
    const { retries = 1, delaySec = 0 } = options ?? {};
    this.steps.push({ type: "fn", fn, retries, delaySec });
    return this;
  }

  private async _retry(
    times: number,
    delaySec: number,
    fn: () => Promise<any> | any,
  ): Promise<any> {
    for (let attempt = 0; attempt < times; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === times - 1) throw err;
        if (delaySec > 0)
          await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }
  }
}
