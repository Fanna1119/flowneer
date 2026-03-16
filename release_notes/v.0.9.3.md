# v0.9.3

## `withCheckpoint` redesigned — options-based API with triggers, history, and `resumeFrom`

`withCheckpoint` has been completely rewritten. The old `(store, filter?)` signature is gone;
it now takes a single `CheckpointOptions` object that gives fine-grained control over when
checkpoints fire, how state is serialised, and whether versioned history is maintained.

`withVersionedCheckpoint` has been removed. All of its functionality — diff snapshots, version
ids, parent pointers, `maxVersions` pruning — is now handled by the unified `withCheckpoint`
plugin via the `history` option.

`resumeFrom` is a new, separately exported `FlowneerPlugin` that resumes execution from a
previously saved version. Because it is its own plugin it can be omitted from flows that
never need resume logic.

### Old API (removed)

```typescript
// withCheckpoint (old)
.withCheckpoint(store)                     // store: { save(stepIndex, shared) }
.withCheckpoint(store, ['llm:*'])          // with StepFilter

// withVersionedCheckpoint (removed)
.withVersionedCheckpoint(store)            // store: VersionedCheckpointStore
```

### New API

```typescript
import { withCheckpoint, resumeFrom } from "flowneer/plugins/persistence";
import type {
  CheckpointOptions,
  CheckpointMeta,
  Trigger,
  HistoryOptions,
} from "flowneer/plugins/persistence";

const AppFlow = FlowBuilder.extend([withCheckpoint, resumeFrom]);

new AppFlow<State>()
  .withCheckpoint({
    save(snapshot, meta) {
      db.save(snapshot, meta);
    },
    on: ["step:after", "error"], // which triggers to activate
    filter: ["llm:*"], // step-scoped triggers only
    serialize: (s) => structuredClone(s), // custom deep-clone
    history: { strategy: "diff", maxVersions: 50 }, // versioned history
  })
  .resumeFrom("v7", { resolve: store.resolve });
```

### `Trigger` values

| Trigger            | When                                   |
| ------------------ | -------------------------------------- |
| `'step:after'`     | After every successful step            |
| `'error'`          | When a step throws                     |
| `'flow:start'`     | Once before the first step runs        |
| `'flow:end'`       | Once after the last step completes     |
| `'loop:iteration'` | After each loop-body iteration         |
| `'anchor:hit'`     | When a goto jump resolves to an anchor |

Default triggers are `['step:after', 'error']` — the same behaviour as the old plugin.

### `CheckpointMeta<S>`

```typescript
interface CheckpointMeta<S> {
  trigger: Trigger;
  stepMeta?: StepMeta; // step:after | error | loop:iteration
  iteration?: number; // loop:iteration only
  anchorName?: string; // anchor:hit only
  error?: unknown; // error only
  version?: string; // history only, e.g. "v3"
  parentVersion?: string | null; // history only
}
```

### Versioned history

When `history` is set each checkpoint is assigned an auto-incrementing version id
(`'v1'`, `'v2'`, …) and a `parentVersion` pointer, forming a linked chain. Use
`strategy: 'diff'` to store only changed keys instead of the full snapshot.

```typescript
.withCheckpoint({
  save(snapshot, meta) {
    // snapshot contains only changed keys when strategy === 'diff'
    versionStore.set(meta.version!, { data: snapshot, parent: meta.parentVersion });
  },
  history: { strategy: 'diff', maxVersions: 100 },
})
```

### `resumeFrom`

```typescript
.resumeFrom(version, { resolve: (v) => ({ stepIndex, snapshot }) })
```

Steps whose index is ≤ `stepIndex` are skipped. If `snapshot` is present in the
resolved entry it is merged into `shared` before the first live step runs.

### Migration from v0.9.2

```typescript
// Before
const store: CheckpointStore = { save: (i, s) => map.set(i, s) };
.withCheckpoint(store)
.withCheckpoint(store, ['llm:*'])

const vStore: VersionedCheckpointStore = { save(entry) { … }, resolve(v) { … } };
.withVersionedCheckpoint(vStore)
.resumeFrom('v3', vStore)

// After
const store = {
  save(snapshot: State, meta: CheckpointMeta<State>) { map.set(meta.stepMeta!.index, snapshot); },
  resolve(v: string) { return { stepIndex: …, snapshot: … }; },
};
.withCheckpoint({ save: store.save })
.withCheckpoint({ save: store.save, filter: ['llm:*'] })
.withCheckpoint({ save: store.save, history: { strategy: 'diff' } })
.resumeFrom('v3', { resolve: store.resolve })
```

---

## New core hooks: `onLoopIteration` and `onAnchorHit`

Two new `FlowHooks` entries give plugins first-class visibility into loop
iterations and anchor jumps.

| Hook              | Signature                           | Fires                               |
| ----------------- | ----------------------------------- | ----------------------------------- |
| `onLoopIteration` | `(meta, iteration, shared, params)` | After each loop body completes      |
| `onAnchorHit`     | `(anchorName, shared, params)`      | When a `goto` resolves to an anchor |

These hooks are what power the `'loop:iteration'` and `'anchor:hit'` triggers in
`withCheckpoint`, but any plugin can register them via the standard `_setHooks` API.

---

## `withCheckpoint` and `resumeFrom` are now separate plugins

Previously `resumeFrom` was a method on the object returned by `withCheckpoint`.
It is now a standalone `FlowneerPlugin` export. This means:

- Flows that only checkpoint and never resume do not pay any overhead for resume logic.
- The two plugins can be independently included in different `FlowBuilder.extend()` calls.

```typescript
// Checkpoint-only flow (e.g. audit trail)
const WriteFlow = FlowBuilder.extend([withCheckpoint]);

// Recovery flow that also needs resume
const RecoveryFlow = FlowBuilder.extend([withCheckpoint, resumeFrom]);
```

---

## Removed

- `withVersionedCheckpoint` — superseded by `withCheckpoint` with `history` option.
- `VersionedCheckpointStore` type — superseded by `CheckpointOptions`.
- `VersionedCheckpointEntry` type — superseded by `CheckpointMeta`.
- `CheckpointStore` type (old `{ save(stepIndex, shared) }` interface) — the new `save` callback is inline in `CheckpointOptions`.
