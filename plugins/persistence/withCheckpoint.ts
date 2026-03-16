import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Events that can trigger a checkpoint save.
 *
 * - `step:after`      — after every successful step (respects `filter`)
 * - `error`           — when a step throws (respects `filter`)
 * - `flow:start`      — once before the first step runs
 * - `flow:end`        — once after the last step completes (even on error)
 * - `loop:iteration`  — after each loop body iteration completes (respects `filter`)
 * - `anchor:hit`      — when a goto jump resolves to an anchor
 */
export type Trigger =
  | "step:after"
  | "error"
  | "flow:start"
  | "flow:end"
  | "loop:iteration"
  | "anchor:hit";

/**
 * Metadata passed to the `save` callback describing why the checkpoint fired.
 */
export interface CheckpointMeta<S = any> {
  /** What caused this checkpoint to fire. */
  trigger: Trigger;
  /** Present for step-scoped triggers: `step:after`, `error`, `loop:iteration`. */
  stepMeta?: StepMeta;
  /** Zero-based iteration index. Present when `trigger === 'loop:iteration'`. */
  iteration?: number;
  /** Anchor label (without `#`). Present when `trigger === 'anchor:hit'`. */
  anchorName?: string;
  /** The thrown error. Present when `trigger === 'error'`. */
  error?: unknown;
  /** Version id. Only set when the `history` option is enabled. */
  version?: string;
  /** Parent version id. Only set when the `history` option is enabled. */
  parentVersion?: string | null;
}

export interface HistoryOptions {
  /**
   * Maximum number of checkpoint versions to retain.
   * When exceeded, the oldest version is pruned.
   * Default: unlimited.
   */
  maxVersions?: number;
  /**
   * `'full'` stores the complete serialized snapshot per version.
   * `'diff'` stores only the keys that changed from the previous checkpoint.
   * Default: `'full'`.
   */
  strategy?: "full" | "diff";
}

export interface CheckpointOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Called whenever a checkpoint fires.
   * Receives the serialized snapshot (or diff when `history.strategy === 'diff'`)
   * and metadata describing the trigger.
   */
  save: (snapshot: S, meta: CheckpointMeta<S>) => void | Promise<void>;
  /**
   * Which triggers activate checkpointing.
   * Default: `['step:after', 'error']`.
   */
  on?: Trigger[];
  /**
   * Narrow which steps trigger step-scoped checkpoints (`step:after`, `error`,
   * `loop:iteration`). Accepts label globs or a predicate.
   * Has no effect on flow- or anchor-level triggers.
   */
  filter?: StepFilter;
  /**
   * Custom serialization. Receives the live shared object and must return a
   * deep-copied snapshot safe to store. Default: `structuredClone`.
   */
  serialize?: (s: S) => S;
  /**
   * Enable versioned history. When set, each checkpoint is assigned a version
   * id and a parent pointer, and `maxVersions` pruning is enforced.
   */
  history?: HistoryOptions;
}

// ---------------------------------------------------------------------------
// History internals
// ---------------------------------------------------------------------------

interface VersionEntry<S> {
  version: string;
  snapshot: S; // full or diff depending on strategy
  parentVersion: string | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Declaration merge
// ---------------------------------------------------------------------------

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Save checkpoints based on configurable triggers.
     *
     * @example
     * flow.withCheckpoint({
     *   save: (snap, meta) => db.save(snap, meta),
     *   on: ["step:after", "error"],
     *   history: { maxVersions: 10 },
     * });
     */
    withCheckpoint(options: CheckpointOptions<S, P>): this;
    /**
     * Resume execution from a previously saved checkpoint version.
     * Steps whose index is ≤ the saved `stepIndex` are skipped.
     * If `snapshot` is present in the resolved entry, `shared` is updated
     * in-place before the first un-skipped step.
     */
    resumeFrom(
      version: string,
      store: {
        resolve: (
          version: string,
        ) =>
          | { stepIndex: number; snapshot?: S }
          | Promise<{ stepIndex: number; snapshot?: S }>;
      },
    ): this;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  for (const key of Object.keys(prev)) {
    if (!(key in curr)) {
      diff[key] = undefined;
    }
  }
  return diff as Partial<S>;
}

// ---------------------------------------------------------------------------
// withCheckpoint plugin
// ---------------------------------------------------------------------------

export const withCheckpoint: FlowneerPlugin = {
  withCheckpoint(this: FlowBuilder<any, any>, options: CheckpointOptions) {
    const {
      save,
      on = ["step:after", "error"],
      filter,
      serialize = (s: any) => structuredClone(s),
      history,
    } = options;

    const triggers = new Set(on);

    // Instance-scoped version counter — each flow instance has its own counter
    let versionCounter = 0;
    let prevSnapshot: Record<string, any> | null = null;
    const historyMap = history ? new Map<string, VersionEntry<any>>() : null;
    const versionOrder: string[] = [];

    const doSave = async (
      trigger: Trigger,
      meta: Omit<CheckpointMeta<any>, "version" | "parentVersion">,
      shared: any,
    ) => {
      const snapshot = serialize(shared);

      // Compute diff snapshot if needed (before updating prevSnapshot)
      let payloadSnapshot: any = snapshot;
      if (history?.strategy === "diff" && prevSnapshot !== null) {
        payloadSnapshot = diffObjects(prevSnapshot, snapshot);
      }

      // Update prevSnapshot for next diff computation
      if (history?.strategy === "diff") {
        prevSnapshot = JSON.parse(JSON.stringify(shared));
      }

      let version: string | undefined;
      let parentVersion: string | null | undefined;

      if (historyMap) {
        const lastVersion =
          versionOrder.length > 0
            ? versionOrder[versionOrder.length - 1]!
            : null;

        version = `v${++versionCounter}`;
        parentVersion = lastVersion;

        historyMap.set(version, {
          version,
          snapshot: payloadSnapshot,
          parentVersion,
          timestamp: Date.now(),
        });
        versionOrder.push(version);

        // Prune oldest versions when over limit
        if (
          history!.maxVersions !== undefined &&
          versionOrder.length > history!.maxVersions
        ) {
          const oldest = versionOrder.shift()!;
          historyMap.delete(oldest);
        }
      }

      await save(payloadSnapshot, {
        ...meta,
        ...(version !== undefined ? { version, parentVersion } : {}),
      });
    };

    // -------------------------------------------------------------------------
    // Step-scoped hooks — respect the filter option
    // -------------------------------------------------------------------------
    const stepHooks: Record<string, any> = {};

    if (triggers.has("step:after")) {
      stepHooks.afterStep = async (meta: StepMeta, shared: any) => {
        await doSave(
          "step:after",
          { trigger: "step:after", stepMeta: meta },
          shared,
        );
      };
    }

    if (triggers.has("error")) {
      stepHooks.onError = async (
        meta: StepMeta,
        error: unknown,
        shared: any,
      ) => {
        await doSave(
          "error",
          { trigger: "error", stepMeta: meta, error },
          shared,
        );
      };
    }

    if (triggers.has("loop:iteration")) {
      stepHooks.onLoopIteration = async (
        meta: StepMeta,
        iteration: number,
        shared: any,
      ) => {
        await doSave(
          "loop:iteration",
          { trigger: "loop:iteration", stepMeta: meta, iteration },
          shared,
        );
      };
    }

    if (Object.keys(stepHooks).length > 0) {
      (this as any)._setHooks(stepHooks, filter);
    }

    // -------------------------------------------------------------------------
    // Flow-scoped and anchor hooks — no filter applied
    // -------------------------------------------------------------------------
    const flowHooks: Record<string, any> = {};

    if (triggers.has("flow:start")) {
      flowHooks.beforeFlow = async (shared: any) => {
        await doSave("flow:start", { trigger: "flow:start" }, shared);
      };
    }

    if (triggers.has("flow:end")) {
      flowHooks.afterFlow = async (shared: any) => {
        await doSave("flow:end", { trigger: "flow:end" }, shared);
      };
    }

    if (triggers.has("anchor:hit")) {
      flowHooks.onAnchorHit = async (anchorName: string, shared: any) => {
        await doSave(
          "anchor:hit",
          { trigger: "anchor:hit", anchorName },
          shared,
        );
      };
    }

    if (Object.keys(flowHooks).length > 0) {
      (this as any)._setHooks(flowHooks);
    }

    return this;
  },
};

// ---------------------------------------------------------------------------
// resumeFrom plugin (separate export so it can be extended independently)
// ---------------------------------------------------------------------------

export const resumeFrom: FlowneerPlugin = {
  resumeFrom(
    this: FlowBuilder<any, any>,
    version: string,
    store: {
      resolve: (
        v: string,
      ) =>
        | { stepIndex: number; snapshot?: any }
        | Promise<{ stepIndex: number; snapshot?: any }>;
    },
  ) {
    let resolvedIndex: number | null = null;
    let resolved = false;

    (this as any)._setHooks({
      wrapStep: async (
        meta: StepMeta,
        next: () => Promise<void>,
        shared: any,
      ) => {
        if (!resolved) {
          const result = await store.resolve(version);
          resolvedIndex = result.stepIndex;
          // Restore snapshot into shared in-place before the first live step
          if (result.snapshot !== undefined) {
            Object.assign(shared, result.snapshot);
          }
          resolved = true;
        }
        if (resolvedIndex !== null && meta.index <= resolvedIndex) {
          return; // skip step
        }
        await next();
      },
    });

    return this;
  },
};
