# withChannels

Provides a named message channel system on `shared.__channels`. Steps communicate asynchronously by sending messages to named channels and draining them in subsequent steps or parallel workers.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withChannels } from "flowneer/plugins/messaging";

FlowBuilder.use(withChannels);
```

## Usage

```typescript
import { sendTo, receiveFrom, peekChannel } from "flowneer/plugins/messaging";

const flow = new FlowBuilder<State>()
  .withChannels()
  .startWith(async (s) => {
    // Send results to a named channel
    sendTo(s, "processed", { id: 1, value: "result_a" });
    sendTo(s, "processed", { id: 2, value: "result_b" });
  })
  .then(async (s) => {
    // Drain the channel — returns all pending messages and clears it
    const items = receiveFrom<{ id: number; value: string }>(s, "processed");
    console.log(items); // [{ id: 1, value: "result_a" }, { id: 2, value: "result_b" }]
  });
```

## Helper Functions

```typescript
import { sendTo, receiveFrom, peekChannel } from "flowneer/plugins/messaging";
```

| Function      | Signature                            | Description                                              |
| ------------- | ------------------------------------ | -------------------------------------------------------- |
| `sendTo`      | `(shared, channel, message) => void` | Enqueue a message on the named channel                   |
| `receiveFrom` | `(shared, channel) => T[]`           | Drain and return all pending messages (clears the queue) |
| `peekChannel` | `(shared, channel) => T[]`           | Return messages without clearing the queue               |

## Pattern: Fan-out / Fan-in

```typescript
const flow = new FlowBuilder<State>()
  .withChannels()
  .startWith(async (s) => {
    // Fan-out: producer sends items
    for (const task of s.tasks) {
      sendTo(s, "tasks", task);
    }
  })
  .parallel([
    async (s) => {
      const myTasks = receiveFrom(s, "tasks");
      for (const t of myTasks) {
        const result = await processTask(t);
        sendTo(s, "results", result);
      }
    },
    // more workers...
  ])
  .then(async (s) => {
    // Fan-in: collect all results
    s.finalResults = receiveFrom(s, "results");
  });
```

## Notes

- Channels are backed by `Map<string, unknown[]>` stored on `shared.__channels`.
- `withChannels()` initialises `shared.__channels` in `beforeFlow` if it doesn't already exist.
- Messages are not typed at the channel level — use generics in `receiveFrom<T>` for safety.
- Channel state persists across steps for the duration of a `.run()` call.
