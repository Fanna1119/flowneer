import type { FlowneerPlugin } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VersionedCheckpointEntry<S = any> {
  version: string;
  stepIndex: number;
  /** JSON-serialisable diff — only keys that changed from the previous version. */
  diff: Partial<S>;
  parentVersion: string | null;
  timestamp: number;
}

export interface VersionedCheckpointStore<S = any> {
  /** Save a versioned checkpoint. Implementation assigns version ids. */
  save(entry: VersionedCheckpointEntry<S>): void | Promise<void>;
  /** Resolve a version id to the full snapshot + step index. */
  resolve(
    version: string,
  ):
    | { stepIndex: number; snapshot: S }
    | Promise<{ stepIndex: number; snapshot: S }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Save diff-based versioned checkpoints after each step.
     * Each checkpoint records only the keys that changed, plus a parent pointer.
     */
    withVersionedCheckpoint(store: VersionedCheckpointStore<S>): this;
    /**
     * Resume execution from a previously saved version.
     * Steps before the saved `stepIndex` are skipped.
     */
    resumeFrom(version: string, store: VersionedCheckpointStore<S>): this;
  }
}

function diffObjects<S extends Record<string, any>>(
  prev: Record<string, any>,
  curr: Record<string, any>,
): Partial<S> {
  const diff: Record<string, any> = {};
  for (const key of Object.keys(curr)) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
      diff[key] = curr[key];
    }
  }
  // Keys removed
  for (const key of Object.keys(prev)) {
    if (!(key in curr)) {
      diff[key] = undefined;
    }
  }
  return diff as Partial<S>;
}

let versionCounter = 0;

export const withVersionedCheckpoint: FlowneerPlugin = {
  withVersionedCheckpoint(this: any, store: VersionedCheckpointStore) {
    let prevSnapshot: Record<string, any> = {};
    let lastVersion: string | null = null;

    this._setHooks({
      beforeFlow: (shared: any) => {
        prevSnapshot = JSON.parse(JSON.stringify(shared));
        lastVersion = null;
      },
      afterStep: async (meta: any, shared: any) => {
        const curr = JSON.parse(JSON.stringify(shared));
        const diff = diffObjects(prevSnapshot, curr);

        // Only save if something actually changed
        if (Object.keys(diff).length === 0) return;

        const version = `v${++versionCounter}`;
        const entry: VersionedCheckpointEntry = {
          version,
          stepIndex: meta.index,
          diff,
          parentVersion: lastVersion,
          timestamp: Date.now(),
        };
        await store.save(entry);
        lastVersion = version;
        prevSnapshot = curr;
      },
    });
    return this;
  },

  resumeFrom(this: any, version: string, store: VersionedCheckpointStore) {
    // We need to resolve the version to get the stepIndex, then skip steps before it.
    // Since resolution might be async, we use wrapStep to lazily resolve on first call.
    let resolvedStep: number | null = null;
    let resolved = false;

    this._setHooks({
      wrapStep: async (meta: any, next: () => Promise<void>) => {
        if (!resolved) {
          const result = await store.resolve(version);
          resolvedStep = result.stepIndex;
          resolved = true;
        }
        if (resolvedStep !== null && meta.index <= resolvedStep) return; // skip
        await next();
      },
    });
    return this;
  },
};
