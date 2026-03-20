import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepperStatus = "idle" | "paused" | "running" | "done";

export interface StepperController<S = any> {
  /** Current lifecycle status of the stepper. */
  readonly status: StepperStatus;
  /** Metadata for the step currently paused at, if any. */
  readonly pausedAt: StepMeta | undefined;
  /**
   * Release the currently paused step and execute it.
   * Returns a Promise that resolves when the step body has finished
   * (success or failure). Errors are NOT re-thrown here — they propagate
   * through the main `flow.run()` promise instead.
   * Throws synchronously if `status` is not `"paused"`.
   */
  continue(): Promise<void>;
  /**
   * Returns a Promise that resolves with step metadata the next time the flow
   * pauses, or `null` when the flow completes without pausing again.
   * Resolves immediately if already paused or done.
   */
  waitUntilPaused(): Promise<StepMeta | null>;
}

export interface ManualSteppingOptions<S = any> {
  /**
   * Called each time the flow pauses before a matched step.
   * Fires after `status` is set to `"paused"`, before the gate blocks.
   * Useful for logging, UI notifications, or automated inspection.
   */
  onPause?: (meta: StepMeta, shared: S) => void | Promise<void>;
  /**
   * Narrow which steps cause a pause.
   * Steps not matching the filter are executed immediately without pausing.
   * Accepts label globs or a predicate — same semantics as other `StepFilter` uses.
   *
   * @example
   * // Pause only on steps labelled "llm:*"
   * flow.withManualStepping({ filter: ["llm:*"] })
   */
  filter?: StepFilter;
}

// ---------------------------------------------------------------------------
// Declaration merge
// ---------------------------------------------------------------------------

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Enable manual step-by-step execution. After calling `.run()`, the flow
     * pauses before each step (or each step matching `filter` if set).
     * Call `flow.stepper.continue()` to advance one step at a time.
     *
     * @example
     * const ManualFlow = FlowBuilder.extend([withManualStepping]);
     *
     * const flow = new ManualFlow<State>()
     *   .withManualStepping()
     *   .then(step1, { label: "fetch" })
     *   .then(step2, { label: "process" });
     *
     * const done = flow.run(shared);
     *
     * // Option A — explicit continue() calls
     * await flow.stepper.continue(); // runs step1
     * await flow.stepper.continue(); // runs step2
     * await done;
     *
     * // Option B — loop via waitUntilPaused()
     * let meta: StepMeta | null;
     * while ((meta = await flow.stepper.waitUntilPaused()) !== null) {
     *   console.log("paused at", meta.label);
     *   await flow.stepper.continue();
     * }
     * await done;
     */
    withManualStepping(options?: ManualSteppingOptions<S>): this;
    /** The stepper controller — available after calling `.withManualStepping()`. */
    stepper: StepperController<S>;
  }
}

// ---------------------------------------------------------------------------
// withManualStepping plugin
// ---------------------------------------------------------------------------

export const withManualStepping: FlowneerPlugin = {
  withManualStepping(
    this: FlowBuilder<any, any>,
    options: ManualSteppingOptions = {},
  ) {
    const { onPause, filter } = options;

    let _status: StepperStatus = "idle";
    let _pausedAt: StepMeta | undefined;
    let _openGate: (() => void) | null = null;
    let _stepDone: Promise<void> = Promise.resolve();

    // One-shot listeners notified on the next pause or flow completion
    type PauseListener = (meta: StepMeta | null) => void;
    const _pauseListeners = new Set<PauseListener>();

    const notifyPause = (meta: StepMeta | null) => {
      const listeners = [..._pauseListeners];
      _pauseListeners.clear();
      for (const l of listeners) l(meta);
    };

    const stepper: StepperController = {
      get status() {
        return _status;
      },
      get pausedAt() {
        return _pausedAt;
      },
      continue() {
        if (_status !== "paused") {
          throw new Error(
            `withManualStepping: continue() called while status is "${_status}" — only valid when "paused"`,
          );
        }
        _status = "running";
        const release = _openGate!;
        _openGate = null;
        release();
        return _stepDone;
      },
      waitUntilPaused() {
        if (_status === "paused") return Promise.resolve(_pausedAt ?? null);
        if (_status === "done") return Promise.resolve(null);
        return new Promise<StepMeta | null>((r) => _pauseListeners.add(r));
      },
    };

    (this as any).stepper = stepper;

    // -------------------------------------------------------------------------
    // Step-scoped hook — gate each matched step behind a continue() call
    // -------------------------------------------------------------------------
    (this as any)._setHooks(
      {
        wrapStep: async (
          meta: StepMeta,
          next: () => Promise<void>,
          shared: any,
        ) => {
          // Arm the done-promise so continue() can await step completion
          let stepResolve!: () => void;
          _stepDone = new Promise<void>((r) => {
            stepResolve = r;
          });

          const startGate = new Promise<void>((r) => {
            _openGate = r;
          });
          _status = "paused";
          _pausedAt = meta;
          notifyPause(meta);

          if (onPause) await onPause(meta, shared);

          await startGate; // suspended here until continue() is called

          _pausedAt = undefined;

          try {
            await next();
          } finally {
            // Resolve the done-promise; errors propagate through flow.run()
            stepResolve();
            _status = "idle";
          }
        },
      },
      filter,
    );

    // -------------------------------------------------------------------------
    // Flow-scoped hook — mark done and release any pending waitUntilPaused()
    // -------------------------------------------------------------------------
    (this as any)._setHooks({
      afterFlow: () => {
        _status = "done";
        notifyPause(null);
      },
    });

    return this;
  },
};
