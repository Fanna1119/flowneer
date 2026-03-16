# withCheckpoint · resumeFrom

Unified checkpoint plugin — saves snapshots on configurable triggers and optionally maintains a versioned history. `resumeFrom` is its companion plugin for resuming flows from a saved version.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCheckpoint, resumeFrom } from "flowneer/plugins/persistence";

// Both are separate FlowneerPlugin objects — extend with whichever you need.
const AppFlow = FlowBuilder.extend([withCheckpoint, resumeFrom]);
```

## `CheckpointOptions`

```typescript
interface CheckpointOptions<S> {
  /** Called every time a checkpoint fires. */
  save: (snapshot: S, meta: CheckpointMeta<S>) => void | Promise<void>;

  /** Which triggers activate checkpointing. Default: ['step:after', 'error']. */
  on?: Trigger[];

  /** Narrow step-scoped triggers to matching steps only (label glob or predicate). */
  filter?: StepFilter;

  /** Custom deep-clone function. Default: structuredClone. */
  serialize?: (s: S) => S;

  /** Enable versioned history with version ids and parent pointers. */
  history?: HistoryOptions;
}
```

### `Trigger`

| Value              | When it fires                                                |
| ------------------ | ------------------------------------------------------------ |
| `'step:after'`     | After every successful step (default; respects `filter`)     |
| `'error'`          | When a step throws (default; respects `filter`)              |
| `'flow:start'`     | Once before the first step runs                              |
| `'flow:end'`       | Once after the last step completes (even on error)           |
| `'loop:iteration'` | After each loop-body iteration completes (respects `filter`) |
| `'anchor:hit'`     | When a `goto` jump resolves to an anchor                     |

### `CheckpointMeta<S>`

```typescript
interface CheckpointMeta<S> {
  trigger: Trigger;
  stepMeta?: StepMeta; // step:after | error | loop:iteration
  iteration?: number; // loop:iteration only
  anchorName?: string; // anchor:hit only (label without '#')
  error?: unknown; // error only
  version?: string; // set when history is enabled, e.g. "v3"
  parentVersion?: string | null; // set when history is enabled
}
```

### `HistoryOptions`

```typescript
interface HistoryOptions {
  /** 'full' stores a complete snapshot; 'diff' stores only changed keys. Default: 'full'. */
  strategy?: "full" | "diff";
  /** Maximum versions to keep; oldest is pruned when exceeded. */
  maxVersions?: number;
}
```

## Usage

### Basic — save after every step

```typescript
const flow = new AppFlow<State>()
  .withCheckpoint({
    save(snapshot, meta) {
      db.save(snapshot, meta.stepMeta?.index);
    },
  })
  .startWith(stepA)
  .then(stepB)
  .then(stepC);

await flow.run(initialState);
```

### Custom triggers

```typescript
.withCheckpoint({
  save(snapshot, meta) { store.set(meta.trigger, snapshot); },
  on: ['flow:start', 'step:after', 'error', 'flow:end'],
})
```

### Scoped to specific steps via `filter`

```typescript
// Only checkpoint steps whose label matches 'llm:*' or 'api:*'
.withCheckpoint({
  save: (snap, meta) => persist(snap, meta),
  filter: ['llm:*', 'api:*'],
})
```

### Versioned history (full strategy)

Each call to `save` receives a `version` id and a `parentVersion` pointer,
forming a linked chain across the run.

```typescript
const history = new Map<string, { snapshot: State; parent: string | null }>();

.withCheckpoint({
  save(snapshot, meta) {
    history.set(meta.version!, {
      snapshot,
      parent: meta.parentVersion ?? null,
    });
  },
  history: { strategy: 'full', maxVersions: 20 },
})
```

### Versioned history (diff strategy)

Only changed keys are written to `snapshot` — useful for large state objects.

```typescript
.withCheckpoint({
  save(diff, meta) {
    // diff only contains the keys that changed since the last checkpoint
    patchStore.append(meta.version!, diff, meta.parentVersion);
  },
  history: { strategy: 'diff' },
})
```

### Error checkpoint

```typescript
.withCheckpoint({
  save(snapshot, meta) {
    if (meta.trigger === 'error') {
      console.error('step failed:', (meta.error as Error).message);
    }
    db.upsert(snapshot);
  },
  on: ['step:after', 'error'],
})
```

### Loop iteration checkpoint

```typescript
.withCheckpoint({
  save(snapshot, meta) {
    console.log(`iteration ${meta.iteration} done`);
  },
  on: ['loop:iteration'],
})
```

---

## `resumeFrom`

Resumes execution from a previously saved checkpoint version. Steps whose index
is ≤ the saved `stepIndex` are skipped; `shared` is pre-populated from the
saved snapshot before the first live step runs.

```typescript
.resumeFrom(version, store)
```

| Argument        | Type                                                 | Description                                                   |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `version`       | `string`                                             | Version id to resume from (e.g. `"v3"`).                      |
| `store.resolve` | `(v: string) => { stepIndex: number; snapshot?: S }` | Returns the step to resume at and an optional state snapshot. |

### Crash-recovery example

```typescript
const checkpointStore = {
  saved: null as null | { stepIndex: number; snapshot: State },

  save(snapshot: State, meta: CheckpointMeta<State>) {
    this.saved = { stepIndex: meta.stepMeta!.index, snapshot };
  },

  resolve(_version: string) {
    if (!this.saved) throw new Error("no checkpoint");
    return this.saved;
  },
};

const flow = new AppFlow<State>()
  .withCheckpoint({
    save: checkpointStore.save.bind(checkpointStore),
    on: ["step:after"],
  })
  .startWith(stepA)
  .then(stepB) // crashes here
  .then(stepC)
  .then(stepD);

try {
  await flow.run(initialState);
} catch {
  // Re-build the same flow but skip completed steps
  const recoveryFlow = new AppFlow<State>()
    .withCheckpoint({
      save: checkpointStore.save.bind(checkpointStore),
      on: ["step:after"],
    })
    .resumeFrom("last", {
      resolve: checkpointStore.resolve.bind(checkpointStore),
    })
    .startWith(stepA)
    .then(stepB)
    .then(stepC)
    .then(stepD);

  await recoveryFlow.run({} as State); // snapshot is applied automatically
}
```

## Notes

- `save` always receives a **deep-cloned** snapshot (`structuredClone` by default). Override with `serialize` if you need a custom clone.
- `filter` only narrows step-scoped triggers (`step:after`, `error`, `loop:iteration`). It has no effect on `flow:start`, `flow:end`, or `anchor:hit`.
- When `history.strategy === 'diff'`, the very first checkpoint always contains the full snapshot (nothing to diff against).
- `resumeFrom` is a separate plugin so it can be omitted from flows that never need resume logic.
- Pairs naturally with [`withReplay`](./replay.md) as a lightweight alternative that skips steps by index without needing a store.
