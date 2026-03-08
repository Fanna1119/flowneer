// ---------------------------------------------------------------------------
// Flowneer — FlowBuilder class
// ---------------------------------------------------------------------------
//
// FlowBuilder extends CoreFlowBuilder and provides all the primitive step
// builder methods (then, branch, loop, batch, parallel, anchor, etc.).
//
// The execution engine, hook system, and step type dispatch all live in
// CoreFlowBuilder. Step type handlers are registered explicitly below so
// all built-in step types are available on any CoreFlowBuilder instance.
//
// ---------------------------------------------------------------------------

import { registerBuiltinSteps } from "./core/steps/index";
import { CoreFlowBuilder } from "./core/CoreFlowBuilder";
import type { NodeFn, NodeOptions } from "./types";
import type { Step } from "./steps";

registerBuiltinSteps();

/**
 * Fluent builder for composable flows.
 *
 * Steps execute sequentially in the order added. Call `.run(shared)` to execute.
 *
 * **Shared-state safety**: all steps operate on the same shared object.
 * Mutate it directly; avoid spreading/replacing the entire object.
 *
 * Built on top of {@link CoreFlowBuilder} which exposes the raw engine for
 * advanced use cases (custom step types, zero-assumption base class, etc.).
 */
export class FlowBuilder<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> extends CoreFlowBuilder<S, P> {
  // -------------------------------------------------------------------------
  // Builder API
  // -------------------------------------------------------------------------

  /** Set the first step, resetting any prior chain. */
  startWith(fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this {
    this.steps = [];
    this._anchorMap = null;
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
   *
   * @example
   * ```ts
   * const enrich = fragment<S>().then(fetchUser).then(enrichProfile);
   *
   * new FlowBuilder<S>().then(init).add(enrich).then(finalize).run(shared);
   * ```
   */
  add(frag: FlowBuilder<S, P>): this {
    for (const step of frag.steps) this._pushStep(step);
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
    this._pushStep({
      type: "branch",
      router,
      branches,
      ...this._resolveOptions(options),
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
    options?: { label?: string },
  ): this {
    const inner = new FlowBuilder<S, P>();
    body(inner);
    this._pushStep({
      type: "loop",
      condition,
      body: inner,
      label: options?.label,
    });
    return this;
  }

  /**
   * Append a batch step.
   * Runs `processor` once per item extracted by `items`, setting
   * `shared[key]` each time (defaults to `"__batchItem"`).
   *
   * Use a unique `key` when nesting batches so each level has its own namespace.
   */
  batch(
    items: (shared: S, params: P) => Promise<any[]> | any[],
    processor: (b: FlowBuilder<S, P>) => void,
    options?: { key?: string; label?: string },
  ): this {
    const inner = new FlowBuilder<S, P>();
    processor(inner);
    this._pushStep({
      type: "batch",
      itemsExtractor: items,
      processor: inner,
      key: options?.key ?? "__batchItem",
      label: options?.label,
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
    this._pushStep({
      type: "parallel",
      fns,
      ...this._resolveOptions(options),
      reducer,
    });
    return this;
  }

  /**
   * Insert a named anchor. Anchors are no-op markers that can be jumped to
   * from any `NodeFn` by returning `"#anchorName"`.
   *
   * @param name - Anchor identifier, referenced as `"#name"` in goto returns.
   * @param maxVisits - Optional cycle guard: throws after this many gotos to
   *   this anchor per `run()`. Replaces the need for a separate `withCycles`
   *   plugin call.
   *
   * @example
   * ```ts
   * flow
   *   .anchor("refine", 5)   // allow up to 5 refinement iterations
   *   .then(generateDraft)
   *   .then(s => s.score < 0.9 ? "#refine" : undefined)
   *   .then(publish);
   * ```
   */
  anchor(name: string, maxVisits?: number): this {
    this._pushStep({
      type: "anchor",
      name,
      ...(maxVisits !== undefined && { maxVisits }),
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _addFn(fn: NodeFn<S, P>, options?: NodeOptions<S, P>): this {
    this._pushStep({
      type: "fn",
      fn,
      ...this._resolveOptions(options),
    });
    return this;
  }
}
