# FlowBuilder API

`FlowBuilder<S, P>` is the central class in Flowneer. All flow construction happens through its fluent, chainable API.

## Constructor

```typescript
const flow = new FlowBuilder<MyState>();
// With params type:
const flow = new FlowBuilder<MyState, MyParams>();
```

---

## `.startWith(fn, options?)`

Resets any previously chained steps and sets the first step of the flow.

```typescript
flow.startWith(async (s) => {
  s.initialized = true;
});
```

| Parameter | Type                | Description                      |
| --------- | ------------------- | -------------------------------- |
| `fn`      | `NodeFn<S, P>`      | The step function                |
| `options` | `NodeOptions<S, P>` | Optional retries, delay, timeout |

---

## `.then(fn, options?)`

Appends a sequential step after the current chain.

```typescript
flow.startWith(fetchData).then(processData).then(saveData);
```

---

## `.branch(router, branches, options?)`

Routes execution to one of several branches based on the return value of `router`.

```typescript
flow.branch(
  (s) => s.sentiment, // returns a key
  {
    positive: async (s) => {
      s.reply = "Great!";
    },
    negative: async (s) => {
      s.reply = "Sorry to hear that.";
    },
    default: async (s) => {
      s.reply = "Thanks!";
    },
  },
);
```

- `router` returns a string key. If the key is not found, the `"default"` branch runs.
- Both `router` and the selected branch function are retried together according to `options`.
- A branch function can return an `"#anchorName"` string to jump to an anchor like any other step.

---

## `.loop(condition, body)`

Repeatedly executes `body` while `condition` returns `true`.

```typescript
flow.loop(
  (s) => s.retries < 3,
  (b) =>
    b.startWith(async (s) => {
      s.result = await tryOperation(s);
      s.retries++;
    }),
);
```

The `body` callback receives an inner `FlowBuilder` — chain steps on it exactly as you would on the outer flow.

---

## `.batch(items, processor, options?)`

Runs `processor` once for each item returned by `items`, setting `shared[key]` to the current item before each run.

```typescript
flow.batch(
  (s) => s.documents, // extract the list
  (b) =>
    b.startWith(async (s) => {
      const doc = s.__batchItem; // current item
      s.results.push(await summarize(doc));
    }),
);
```

**Options:**

| Option | Default         | Description                                      |
| ------ | --------------- | ------------------------------------------------ |
| `key`  | `"__batchItem"` | Key on `shared` where the current item is stored |

**Nesting batches:** use a unique `key` per level to prevent key collisions:

```typescript
flow.batch(
  (s) => s.users,
  (b) =>
    b
      .startWith((s) => console.log(s.__user))
      .batch(
        (s) => s.__user.posts,
        (p) => p.startWith((s) => console.log(s.__post)),
        { key: "__post" },
      ),
  { key: "__user" },
);
```

---

## `.parallel(fns, options?, reducer?)`

Runs all functions concurrently against the same `shared` state.

```typescript
flow.parallel([
  async (s) => {
    s.weatherData = await fetchWeather();
  },
  async (s) => {
    s.newsData = await fetchNews();
  },
  async (s) => {
    s.stockData = await fetchStocks();
  },
]);
```

**With a `reducer` (safe mode):** each function receives its own shallow draft of `shared`. After all complete, the reducer merges results back — preventing concurrent write conflicts:

```typescript
flow.parallel([workerA, workerB, workerC], undefined, (shared, drafts) => {
  shared.results = drafts.map((d) => d.output);
});
```

---

## `.anchor(name)`

Inserts a named no-op marker. Any step can jump to an anchor by returning `"#anchorName"`.

```typescript
flow
  .anchor("retry")
  .then(async (s) => {
    s.attempts++;
    if (s.attempts < 3) return "#retry"; // jump back
  })
  .then(finalize);
```

See [Anchors & Routing](./anchors-routing.md) for the full guide.

---

## `.run(shared, params?, options?)`

Executes the flow.

```typescript
await flow.run(initialState);
await flow.run(initialState, { userId: "u1" });
await flow.run(initialState, {}, { signal: abortController.signal });
```

---

## `.stream(shared, params?, options?)`

Executes the flow and yields `StreamEvent` objects as an async generator.

```typescript
for await (const event of flow.stream(shared)) {
  if (event.type === "chunk") process.stdout.write(String(event.data));
  if (event.type === "done") console.log("finished");
}
```

Event types:

| Type          | Payload          | Description                               |
| ------------- | ---------------- | ----------------------------------------- |
| `step:before` | `meta: StepMeta` | Fired before each step                    |
| `step:after`  | `meta, shared`   | Fired after each step                     |
| `chunk`       | `data: unknown`  | Yielded from a generator step or `emit()` |
| `error`       | `error: unknown` | Unhandled error                           |
| `done`        | —                | Flow completed                            |

See [Streaming](./streaming.md) for details.

---

## `FlowBuilder.use(plugin)` — static

Register a plugin globally on `FlowBuilder.prototype`.

```typescript
import { withTiming } from "flowneer/plugins/observability";
FlowBuilder.use(withTiming);
```

Call this once at app startup before creating flows.

---

## `StepMeta`

Exposed to hooks and callbacks:

```typescript
interface StepMeta {
  index: number; // 0-based step index
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  label?: string; // optional label set via NodeOptions
}
```
