// ---------------------------------------------------------------------------
// Flowneer — error classes
// ---------------------------------------------------------------------------

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
