// ---------------------------------------------------------------------------
// Flowneer — Fragment (reusable partial flow)
// ---------------------------------------------------------------------------

import { FlowBuilder } from "./FlowBuilder";

/**
 * A reusable, composable partial flow — the Flowneer equivalent of a Zod
 * partial/fragment.
 *
 * Build a fragment with the same fluent API as `FlowBuilder` (`.then()`,
 * `.loop()`, `.batch()`, `.branch()`, `.parallel()`, `.anchor()`), then
 * splice it into any flow via `FlowBuilder.add(fragment)`.
 *
 * Fragments **cannot** be executed directly — calling `.run()` or `.stream()`
 * will throw. This prevents accidental stand-alone execution of what is
 * intended to be a composable building-block.
 *
 * @example
 * ```ts
 * const enrich = fragment<MyState>()
 *   .then(fetchUser)
 *   .then(enrichProfile);
 *
 * const summarise = fragment<MyState>()
 *   .loop(s => !s.done, b => b.then(summarize));
 *
 * const flow = new FlowBuilder<MyState>()
 *   .then(init)
 *   .add(enrich)
 *   .add(summarise)
 *   .then(finalize);
 *
 * await flow.run(shared);
 * ```
 */
export class Fragment<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> extends FlowBuilder<S, P> {
  /** @internal Fragments cannot be run — embed them via `.add()`. */
  override async run(_shared?: S, _params?: P): Promise<void> {
    throw new Error(
      "Fragment cannot be run directly — use .add() to embed it in a FlowBuilder",
    );
  }

  /** @internal Fragments cannot be streamed — embed them via `.add()`. */
  override async *stream(_shared?: S, _params?: P): AsyncGenerator<any> {
    throw new Error(
      "Fragment cannot be streamed directly — use .add() to embed it in a FlowBuilder",
    );
  }
}

/**
 * Create a new `Fragment` — a reusable, composable partial flow.
 *
 * ```ts
 * const enrichStep = fragment<MyState>()
 *   .then(fetchUser)
 *   .then(enrichProfile);
 *
 * new FlowBuilder<MyState>()
 *   .then(init)
 *   .add(enrichStep)
 *   .run(shared);
 * ```
 */
export function fragment<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(): Fragment<S, P> {
  return new Fragment<S, P>();
}
