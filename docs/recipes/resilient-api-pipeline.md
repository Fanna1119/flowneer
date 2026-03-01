# Resilient API Pipeline

Fetch data from a flaky external API with automatic retries, a per-step timeout, a circuit breaker to stop hammering a dead endpoint, and a fallback to cached data when everything fails.

**Plugins used:** `withCircuitBreaker`, `withTimeout`, `withFallback` (resilience), step-level `retries` + `delaySec`

---

## The code

```typescript
import "dotenv/config";
import { FlowBuilder } from "flowneer";
import {
  withCircuitBreaker,
  withTimeout,
  withFallback,
} from "flowneer/plugins/resilience";
import { withTiming } from "flowneer/plugins/observability";

FlowBuilder.use(withCircuitBreaker);
FlowBuilder.use(withFallback);
FlowBuilder.use(withTiming);

// ─── State ───────────────────────────────────────────────────────────────────

interface PipelineState {
  productId: string;
  productData: Record<string, unknown> | null;
  enrichedData: Record<string, unknown> | null;
  finalRecord: Record<string, unknown> | null;
  fromCache: boolean;
  __timings?: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchProduct(id: string) {
  const res = await fetch(`https://api.example.com/products/${id}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCachedProduct(id: string) {
  // Fall back to a local cache / DB
  return { id, name: "Cached Product", price: 0, fromCache: true };
}

async function enrichProduct(product: Record<string, unknown>) {
  const res = await fetch(
    `https://api.enrich.example.com/enrich?id=${product.id}`,
  );
  if (!res.ok) throw new Error(`Enrich HTTP ${res.status}`);
  return { ...product, ...(await res.json()) };
}

// ─── Flow ────────────────────────────────────────────────────────────────────

const pipeline = new FlowBuilder<PipelineState>()
  .withTiming()

  // Step 1 — Fetch product, retry up to 3×, 1 s delay, 5 s timeout
  // Circuit breaker trips after 5 consecutive failures across all runs
  .withCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 })
  .withFallback(async (s) => {
    // Circuit open or all retries exhausted — use cache
    s.productData = (await fetchCachedProduct(s.productId)) as any;
    s.fromCache = true;
  })
  .startWith(
    async (s) => {
      s.productData = await fetchProduct(s.productId);
      s.fromCache = false;
    },
    { retries: 3, delaySec: 1, timeoutMs: 5_000 },
  )

  // Step 2 — Enrich (skip if we're working from cache)
  .then(
    async (s) => {
      if (s.fromCache) return; // no point enriching stale data
      s.enrichedData = await enrichProduct(s.productData!);
    },
    { retries: 2, delaySec: 0.5, timeoutMs: 4_000 },
  )

  // Step 3 — Normalise into a final record
  .then(async (s) => {
    const base = s.enrichedData ?? s.productData ?? {};
    s.finalRecord = {
      ...base,
      processedAt: new Date().toISOString(),
      source: s.fromCache ? "cache" : "live",
    };
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

const state: PipelineState = {
  productId: "prod_123",
  productData: null,
  enrichedData: null,
  finalRecord: null,
  fromCache: false,
};

await pipeline.run(state);

console.log("Final record:", state.finalRecord);
console.log("Step timings (ms):", state.__timings);
if (state.fromCache) console.warn("Warning: data served from cache.");
```

---

## Resilience layers explained

### Step-level retries + delay

Pass `{ retries: 3, delaySec: 1 }` as the second argument to `.startWith()` or `.then()`. Flowneer retries the step up to 3 times total (not 3 additional — 1 attempt + 2 retries) with a 1 s gap.

```typescript
.startWith(fetchFn, { retries: 3, delaySec: 1 })
```

### Per-step timeout

`timeoutMs` wraps the step in a `Promise.race` against a rejection timer. If the step exceeds the limit, Flowneer throws `StepTimeoutError` (which triggers the retry/fallback chain).

```typescript
.then(slowFn, { timeoutMs: 5_000 })
```

### Circuit breaker

`withCircuitBreaker` tracks failures across all flow runs. After `failureThreshold` consecutive failures the circuit trips to **open** — subsequent runs skip the protected step(s) entirely (triggering the fallback) until `resetTimeoutMs` elapses.

```typescript
.withCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 })
```

### Fallback

`.withFallback(fn)` runs `fn` whenever any step in the flow throws an unhandled error — after all retries are exhausted and the circuit is open. Use it to write safe recovery logic.

---

## Variation — timeout at the flow level

To abort the entire pipeline after a wall-clock deadline, pass an `AbortSignal`:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000); // 10 s total budget

await pipeline.run(state, {}, { signal: controller.signal });
```

---

## See also

- [withCircuitBreaker](../plugins/resilience/circuit-breaker.md)
- [withTimeout](../plugins/resilience/timeout.md)
- [withFallback](../plugins/resilience/fallback.md)
- [withTiming](../plugins/observability/timing.md)
