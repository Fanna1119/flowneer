# Anchors & Routing

Anchors give you fine-grained control over flow execution order. Any step can jump to a named anchor by returning `"#anchorName"`, enabling loops, retries, and conditional skips without needing the `.loop()` primitive.

## Defining an Anchor

```typescript
flow
  .anchor("retry")
  .then(processStep)
  .then(async (s) => {
    if (s.failed) return "#retry"; // jump back to the anchor
  })
  .then(finalStep);
```

`anchor(name)` inserts a no-op marker. The for-loop in the executor increments the step index past the anchor, so the **next step after the anchor** is the effective entry point.

## How goto Works

When a `fn` step returns a string starting with `#`, the executor:

1. Strips the `#` prefix to get the anchor name.
2. Looks up the anchor's step index.
3. Sets the iteration counter to that index — the next iteration lands on the **anchor step**, skips it (since it's a no-op), and continues with the following step.

## Branching with Anchors

Anchors work in `.branch()` too:

```typescript
flow.branch((s) => s.action, {
  retry: async (s) => {
    s.retries++;
    return "#start";
  },
  finish: async (s) => {
    s.done = true;
  },
});
```

## Forward Jumps (Skip Ahead)

Anchors can also be placed _after_ the jumping step for forward skips:

```typescript
flow
  .then(async (s) => {
    if (s.skipProcessing) return "#save";
  })
  .then(expensiveProcessing)
  .anchor("save")
  .then(saveResults);
```

## Guard Against Infinite Loops

Use [`withCycles`](../plugins/resilience/cycles.md) to cap the number of anchor jumps:

```typescript
FlowBuilder.use(withCycles);

flow
  .withCycles(50) // max 50 total jumps per run
  .withCycles(5, "retry") // max 5 jumps to the "retry" anchor
  .anchor("retry")
  .then(doWork)
  .then((s) => {
    if (!s.ok) return "#retry";
  });
```

## Anchors in Generator Steps

Generator steps can also return an anchor:

```typescript
.then(async function* (s) {
  for await (const token of stream(s.prompt)) {
    s.output += token;
    yield token;
  }
  if (s.output.includes("ERROR")) return "#retry";
})
```

The generator's **return value** (not yield) is used for routing.
