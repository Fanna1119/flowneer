# v0.4.1

## Breaking change — `withCycles` semantics

The counting behaviour of `withCycles(n)` has changed:

| Before                                                  | After                                  |
| ------------------------------------------------------- | -------------------------------------- |
| Counted every step execution (including non-goto steps) | Counts only anchor jumps (goto events) |

Flows that loop via `return "#anchor"` are counted the same way. Flows with no goto jumps will never trip the limit regardless of how many steps they contain.

## New: per-anchor cycle limits

`withCycles` now accepts an optional anchor name as a second argument, scoping the limit to visits to that specific anchor.

```typescript
// Global: max 100 total anchor jumps
flow.withCycles(100);

// Per-anchor: max 5 visits to "refine", unlimited elsewhere
flow.withCycles(5, "refine");

// Combined — chain calls, each limit is independent
flow
  .withCycles(100) // global cap
  .withCycles(5, "fast") // "fast" anchor capped at 5
  .withCycles(10, "retry"); // "retry" anchor capped at 10
```

Unlisted anchors are unaffected by per-anchor limits. Both a per-anchor limit and the global limit can trigger on the same jump.
