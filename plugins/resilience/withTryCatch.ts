import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import { FlowError } from "../../Flowneer";

// ---------------------------------------------------------------------------
// Internal block descriptor — mutated by .catch() and .finally() before the
// step fn executes at runtime.
// ---------------------------------------------------------------------------

interface TryCatchBlock {
  tryFrag: FlowBuilder<any, any>;
  catchFrag: FlowBuilder<any, any> | null;
  finallyFrag: FlowBuilder<any, any> | null;
}

const PENDING_KEY = "__flowneerPendingTryCatch";

// ---------------------------------------------------------------------------
// Declaration merging
// ---------------------------------------------------------------------------

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Begin a try / catch / finally block.
     *
     * Executes all steps in `tryFrag`. If any step throws:
     *  - the `.catch()` fragment runs (if registered), with the caught error
     *    available as `shared.__tryError`;
     *  - if no `.catch()` fragment is registered the error propagates.
     *
     * The `.finally()` fragment (if registered) always runs last, regardless
     * of success or failure.
     *
     * @example
     * flow
     *   .try(
     *     fragment().then(risky).then(another)
     *   )
     *   .catch(
     *     fragment()
     *       .then((s) => { s.recovery = true; })
     *       .anchor("recover")
     *       .then(recoveryStep)
     *   )
     *   .finally(
     *     fragment().then(cleanup)
     *   );
     */
    try(tryFrag: FlowBuilder<S, P>): this;

    /**
     * Register the catch handler for the immediately preceding `.try()` block.
     *
     * The caught error is stored on `shared.__tryError` before the fragment
     * runs and removed once it completes (or throws). Access the original
     * error and its `.cause` inside the catch fragment:
     *
     * ```ts
     * .catch(fragment().then((s) => console.error(s.__tryError)))
     * ```
     */
    catch(catchFrag: FlowBuilder<S, P>): this;

    /**
     * Register a finally handler that always runs after the preceding `.try()`
     * (and optional `.catch()`) block — whether or not an error was thrown.
     *
     * Clears the pending try/catch state from the builder.
     */
    finally(finallyFrag: FlowBuilder<S, P>): this;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const withTryCatch: FlowneerPlugin = {
  try(this: FlowBuilder<any, any>, tryFrag: FlowBuilder<any, any>) {
    const block: TryCatchBlock = {
      tryFrag,
      catchFrag: null,
      finallyFrag: null,
    };

    // Store the block so .catch() and .finally() can amend it before the
    // flow runs. Overwriting any previous pending block is intentional —
    // the old block's fn step already captured a reference via closure.
    (this as any)[PENDING_KEY] = block;

    // Add a single fn step whose behaviour is determined at runtime by
    // whichever .catch() / .finally() calls follow .try().
    (this as any)._addFn(async (shared: any, params: any) => {
      let thrownError: unknown;
      let didThrow = false;

      // --- try ---------------------------------------------------------------
      try {
        await (block.tryFrag as any)._execute(shared, params, undefined);
      } catch (tryErr) {
        if (block.catchFrag) {
          // --- catch -----------------------------------------------------------
          // Unwrap FlowError so the consumer sees the original cause.
          shared.__tryError =
            tryErr instanceof FlowError ? tryErr.cause : tryErr;
          try {
            await (block.catchFrag as any)._execute(shared, params, undefined);
          } catch (catchErr) {
            thrownError = catchErr;
            didThrow = true;
          } finally {
            delete shared.__tryError;
          }
        } else {
          // No catch handler — bubble the error (after finally).
          thrownError = tryErr;
          didThrow = true;
        }
      }

      // --- finally -----------------------------------------------------------
      if (block.finallyFrag) {
        await (block.finallyFrag as any)._execute(shared, params, undefined);
      }

      if (didThrow) throw thrownError;
    });

    return this;
  },

  catch(this: FlowBuilder<any, any>, catchFrag: FlowBuilder<any, any>) {
    const block: TryCatchBlock | undefined = (this as any)[PENDING_KEY];
    if (!block) {
      throw new Error(
        "withTryCatch: .catch() must be called immediately after .try()",
      );
    }
    block.catchFrag = catchFrag;
    return this;
  },

  finally(this: FlowBuilder<any, any>, finallyFrag: FlowBuilder<any, any>) {
    const block: TryCatchBlock | undefined = (this as any)[PENDING_KEY];
    if (!block) {
      throw new Error(
        "withTryCatch: .finally() must be called after .try() or .try().catch()",
      );
    }
    block.finallyFrag = finallyFrag;
    // Clear pending state — the block is now fully configured.
    delete (this as any)[PENDING_KEY];
    return this;
  },
};
