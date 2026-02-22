import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

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
  append: (entry: AuditEntry<S>) => void | Promise<void>;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Writes an immutable audit entry to `store` after each step (success and error).
     * The `shared` snapshot in each entry is a deep clone via `JSON.parse/stringify`.
     */
    withAuditLog(store: AuditLogStore<S>): this;
  }
}

export const withAuditLog: FlowneerPlugin = {
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
};
