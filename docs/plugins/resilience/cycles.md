# withCycles

Guards against infinite anchor-jump loops. Throws when the number of goto jumps exceeds a configured limit.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCycles } from "flowneer/plugins/resilience";

FlowBuilder.use(withCycles);
```

## Usage

### Global jump limit

```typescript
const flow = new FlowBuilder<State>()
  .withCycles(100) // abort after 100 total anchor jumps
  .anchor("retry")
  .then(async (s) => {
    s.attempts++;
    if (s.attempts < 3) return "#retry";
  });
```

### Per-anchor limit

```typescript
flow
  .withCycles(5, "retry") // max 5 jumps to the "retry" anchor
  .anchor("retry")
  .then(async (s) => {
    if (!s.done) return "#retry";
  });
```

### Combined

```typescript
flow
  .withCycles(100) // total jump limit
  .withCycles(5, "retry") // plus per-anchor limit for "retry"
  .withCycles(10, "next"); // plus per-anchor limit for "next"
```

## API

### `.withCycles(maxJumps: number, anchor?: string)`

| Parameter  | Type     | Default     | Description                                                                  |
| ---------- | -------- | ----------- | ---------------------------------------------------------------------------- |
| `maxJumps` | `number` | —           | Maximum number of jumps allowed                                              |
| `anchor`   | `string` | `undefined` | If provided, limits only jumps to this anchor. If omitted, applies globally. |

## How Jump Detection Works

The plugin detects a jump by comparing the current step index with the previous one. A step index that is equal to or less than the previous index indicates a backward jump via goto.

## Error

When the limit is exceeded:

- Global: `"cycle limit exceeded: N anchor jumps > maxJumps(M)"`
- Per-anchor: `"cycle limit exceeded for anchor "name": N visits > limit(M)"`

## Counters Reset per Run

Jump counters reset at `beforeFlow`, so each `.run()` call starts fresh.
