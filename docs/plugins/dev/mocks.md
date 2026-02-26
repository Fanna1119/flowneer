# withMocks

Replaces step bodies at specific indices with mock functions, while letting all other steps run normally. Ideal for unit testing individual steps in isolation.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withMocks } from "flowneer/plugins/dev";

FlowBuilder.use(withMocks);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .startWith(fetchData) // step 0
  .then(processData) // step 1
  .then(saveToDb) // step 2 — will be mocked
  .then(sendNotification); // step 3

// In your test:
const savedItems: any[] = [];

flow.withMocks({
  2: async (s) => {
    // Mock step 2: capture what would have been saved
    savedItems.push(structuredClone(s.processed));
  },
});

await flow.run(testState);

expect(savedItems).toHaveLength(1);
expect(savedItems[0]).toMatchObject({ id: "test-123" });
```

## API

### `.withMocks(map: Record<number, NodeFn<S, P>>)`

| Parameter | Type                     | Description                       |
| --------- | ------------------------ | --------------------------------- |
| `map`     | `Record<number, NodeFn>` | Map of step index → mock function |

Steps not in `map` execute their real bodies normally.

## How It Works

Registers a `wrapStep` hook. When a step's index is in `map`, the mock function is called instead of `next()`. When not in `map`, `next()` is called normally.

## Test Pattern

```typescript
import { describe, it, expect, vi } from "vitest";

describe("myFlow", () => {
  it("calls the notification service with correct data", async () => {
    const notifySpy = vi.fn();

    const flow = buildMyFlow();
    FlowBuilder.use(withMocks);
    flow.withMocks({
      3: notifySpy, // step 3 = sendNotification
    });

    await flow.run({ ...testInitialState });

    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy.mock.calls[0][0].result).toBe("expected value");
  });
});
```

## Notes

- Multiple calls to `withMocks` stack — later registrations override earlier ones for the same index.
- Mock functions receive the same `(shared, params)` arguments as real steps.
- Combine with `withDryRun` on all other steps for fully isolated unit tests.
