// ---------------------------------------------------------------------------
// Persistence plugin — withCheckpoint(store), withAuditLog(store), withReplay(n)
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(persistencePlugin);
//
//   // Checkpoint + replay
//   const store = { data: new Map<number, unknown>() };
//   const checkpointStore: CheckpointStore = {
//     save: (i, s) => store.data.set(i, structuredClone(s)),
//   };
//   const flow = new FlowBuilder<MyState>()
//     .withCheckpoint(checkpointStore)
//     .startWith(step1)
//     .then(step2);
//
//   // Resume from step 2 (restore shared from checkpoint first)
//   const resumed = new FlowBuilder<MyState>()
//     .withReplay(2)
//     .startWith(step1)
//     .then(step2)
//     .then(step3);

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../Flowneer";

// ──────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────

export interface CheckpointStore<S = any> {
  /** Called after each successful step with the step index and current shared state. */
  save: (stepIndex: number, shared: S) => void | Promise<void>;
}

export interface AuditEntry<S = any> {
  stepIndex: number;
  type: string;
  timestamp: number;
  /** Deep clone of `shared` at the time of the event. */
  shared: S;
  /** Error message, present only on failed steps. */
  error?: string;
}

export interface AuditLogStore<S = any> {
  /** Must be synchronous-safe (fire-and-forget async is fine but never throws). */
  append: (entry: AuditEntry<S>) => void | Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────
// Type augmentations
// ──────────────────────────────────────────────────────────────────────────

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Saves `shared` to `store` after each successful step. */
    withCheckpoint(store: CheckpointStore<S>): this;
    /**
     * Writes an immutable audit entry to `store` after each step (success and error).
     * The `shared` snapshot in each entry is a deep clone via `JSON.parse/stringify`.
     */
    withAuditLog(store: AuditLogStore<S>): this;
    /**
     * Skips execution of all steps before `fromStep`.
     * Combine with `.withCheckpoint()`: restore `shared` from the checkpoint store
     * before calling `.run()`, then call `.withReplay(lastSavedIndex + 1)` so only
     * future steps execute.
     */
    withReplay(fromStep: number): this;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Plugin
// ──────────────────────────────────────────────────────────────────────────

export const persistencePlugin: FlowneerPlugin = {
  withCheckpoint(this: FlowBuilder<any, any>, store: CheckpointStore) {
    (this as any)._setHooks({
      afterStep: async (meta: StepMeta, shared: unknown) => {
        await store.save(meta.index, shared);
      },
    });
    return this;
  },

  withAuditLog(this: FlowBuilder<any, any>, store: AuditLogStore) {
    const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
    (this as any)._setHooks({
      afterStep: async (meta: StepMeta, shared: unknown) => {
        await store.append({
          stepIndex: meta.index,
          type: meta.type,
          timestamp: Date.now(),
          shared: clone(shared),
        });
      },
      onError: (meta: StepMeta, err: unknown, shared: unknown) => {
        store.append({
          stepIndex: meta.index,
          type: meta.type,
          timestamp: Date.now(),
          shared: clone(shared),
          error: err instanceof Error ? err.message : String(err),
        });
      },
    });
    return this;
  },

  withReplay(this: FlowBuilder<any, any>, fromStep: number) {
    (this as any)._setHooks({
      wrapStep: async (meta: StepMeta, next: () => Promise<void>) => {
        if (meta.index < fromStep) return; // skip already-executed steps
        await next();
      },
    });
    return this;
  },
};
