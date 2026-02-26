# withVersionedCheckpoint

Saves diff-based versioned checkpoints after each step. Each checkpoint records only the **keys that changed** from the previous step along with a parent pointer, making it efficient for long flows with large state objects.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withVersionedCheckpoint } from "flowneer/plugins/persistence";

FlowBuilder.use(withVersionedCheckpoint);
```

## Store Interface

```typescript
interface VersionedCheckpointEntry<S = any> {
  version: string; // auto-assigned e.g. "v1", "v2"
  stepIndex: number;
  diff: Partial<S>; // only changed keys
  parentVersion: string | null; // null for the first checkpoint
  timestamp: number; // Unix ms
}

interface VersionedCheckpointStore<S = any> {
  save(entry: VersionedCheckpointEntry<S>): void | Promise<void>;
  resolve(
    version: string,
  ):
    | { stepIndex: number; snapshot: S }
    | Promise<{ stepIndex: number; snapshot: S }>;
}
```

## Usage

```typescript
// In-memory versioned store
const versions = new Map<string, VersionedCheckpointEntry>();
const snapshots = new Map<string, { stepIndex: number; snapshot: any }>();

const store: VersionedCheckpointStore = {
  save(entry) {
    versions.set(entry.version, entry);
    // Rebuild full snapshot from parent chain for resolve()
    let snap = {};
    if (entry.parentVersion) {
      snap = { ...snapshots.get(entry.parentVersion)?.snapshot };
    }
    Object.assign(snap, entry.diff);
    snapshots.set(entry.version, {
      stepIndex: entry.stepIndex,
      snapshot: snap,
    });
  },
  resolve(version) {
    return snapshots.get(version)!;
  },
};

const flow = new FlowBuilder<State>()
  .withVersionedCheckpoint(store)
  .startWith(stepA)
  .then(stepB)
  .then(stepC);

await flow.run(initialState);
```

## Resuming from a Version

```typescript
FlowBuilder.use(withVersionedCheckpoint);

// resumeFrom skips all steps up to and including the saved stepIndex
flow.resumeFrom("v2", store);
await flow.run({ ...restoredSnapshot });
```

`.resumeFrom(version, store)` resolves the saved step index on the first step execution and skips all steps up to and including that index.

## Notes

- Only checkpoints are saved when **something actually changed** in shared state.
- Diffs compare JSON serializations — non-JSON-serializable values are not supported.
- Version IDs (`"v1"`, `"v2"`, ...) are assigned by a global counter inside the plugin. In production, override with a UUID-based `save` implementation.
