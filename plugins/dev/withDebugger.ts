import type {
  FlowBuilder,
  FlowHooks,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

export interface DebuggerHooks {
  /** Pause before a step runs. Default: `true`. */
  beforeStep?: boolean;
  /** Pause after a step completes. Default: `false`. */
  afterStep?: boolean;
  /** Pause when a step throws. Default: `false`. */
  onError?: boolean;
  /** Pause once before the step body and once after (inside the wrapper). Default: `false`. */
  wrapStep?: boolean;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Drops a `debugger` statement at the selected lifecycle points.
     * Attach DevTools / `--inspect` breakpoints and step through live flow state.
     *
     * @param filter  Limit to specific steps by label or predicate (optional).
     * @param hooks   Which lifecycle points to pause at. Defaults to `{ beforeStep: true }`.
     *
     * @example
     * // Pause before every step
     * new AppFlow().withDebugger().then(myStep).run(shared);
     *
     * @example
     * // Pause only on "llm:*" steps, before and after
     * new AppFlow()
     *   .withDebugger(["llm:*"], { beforeStep: true, afterStep: true })
     *   .then(callLlm)
     *   .run(shared);
     */
    withDebugger(filter?: StepFilter, hooks?: DebuggerHooks): this;
  }
}

export const withDebugger: FlowneerPlugin = {
  withDebugger(
    this: FlowBuilder<any, any>,
    filter?: StepFilter,
    hooks: DebuggerHooks = { beforeStep: true },
  ) {
    const registered: Partial<FlowHooks<any, any>> = {};

    if (hooks.beforeStep) {
      registered.beforeStep = (
        meta: StepMeta,
        shared: unknown,
        params: unknown,
      ) => {
        // eslint-disable-next-line no-debugger
        debugger; // beforeStep — inspect: meta, shared, params
      };
    }

    if (hooks.afterStep) {
      registered.afterStep = (
        meta: StepMeta,
        shared: unknown,
        params: unknown,
      ) => {
        // eslint-disable-next-line no-debugger
        debugger; // afterStep — inspect: meta, shared, params
      };
    }

    if (hooks.onError) {
      registered.onError = (
        meta: StepMeta,
        error: unknown,
        shared: unknown,
        params: unknown,
      ) => {
        // eslint-disable-next-line no-debugger
        debugger; // onError — inspect: meta, error, shared, params
      };
    }

    if (hooks.wrapStep) {
      registered.wrapStep = async (
        meta: StepMeta,
        next: () => Promise<void>,
        shared: unknown,
        params: unknown,
      ) => {
        // eslint-disable-next-line no-debugger
        debugger; // wrapStep (before body) — inspect: meta, shared, params
        await next();
        // eslint-disable-next-line no-debugger
        debugger; // wrapStep (after body) — inspect: meta, shared, params
      };
    }

    (this as any)._setHooks(registered, filter);
    return this;
  },
};
