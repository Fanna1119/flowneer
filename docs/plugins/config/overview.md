# JsonFlowBuilder

Build and validate `FlowBuilder` instances from a plain JSON (or TypeScript object) configuration.
Useful for dynamic flows, low-code editors, database-driven pipelines, or any scenario where
the flow structure is determined at runtime rather than compile time.

## Setup

```typescript
import { JsonFlowBuilder } from "flowneer/plugins/config";
```

`JsonFlowBuilder` is a standalone class — no `FlowBuilder.extend()` call needed.

---

## Quick start

```typescript
import { JsonFlowBuilder } from "flowneer/plugins/config";

const config = {
  steps: [
    { type: "fn", fn: "fetchUser", label: "pii:user", retries: 2 },
    { type: "fn", fn: "saveResult", label: "save" },
  ],
};

const registry = {
  fetchUser: async (s) => {
    s.user = await db.get(s.userId);
  },
  saveResult: async (s) => {
    await db.save(s.result);
  },
};

const flow = JsonFlowBuilder.build(config, registry);
await flow.run(shared);
```

---

## `FlowConfig` — supported step types

All `FlowBuilder` step types are supported:

```typescript
type StepConfig =
  | {
      type: "fn";
      fn: string;
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | {
      type: "branch";
      router: string;
      branches: Record<string, string>;
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | { type: "loop"; condition: string; body: StepConfig[]; label?: string }
  | {
      type: "batch";
      items: string;
      processor: StepConfig[];
      key?: string;
      label?: string;
    }
  | {
      type: "parallel";
      fns: string[];
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | { type: "anchor"; name: string; maxVisits?: number };

interface FlowConfig {
  steps: StepConfig[];
}
```

All string values (`fn`, `router`, `condition`, etc.) are registry keys — resolved to real functions at build time.

---

## API

### `JsonFlowBuilder.build<S>(config, registry)`

Validates and compiles a `FlowConfig` into a runnable `FlowBuilder<S>`.

Calls `validate()` first. Throws `ConfigValidationError` if the config is invalid.

```typescript
const flow = JsonFlowBuilder.build<MyState>(config, registry);
await flow.run(shared);
```

### `JsonFlowBuilder.validate(config, registry)`

Validates structure and registry references without building. Returns all errors
found — does not short-circuit on the first error.

```typescript
const result = JsonFlowBuilder.validate(config, registry);
if (!result.valid) {
  for (const err of result.errors) {
    console.error(`${err.path}: ${err.message}`);
  }
}
```

`validate()` checks:

1. Structural shape of every step (correct `type`, required fields present)
2. All function references exist in the registry
3. Duplicate anchor names
4. Recursive validation of nested `body` and `processor` arrays

### `JsonFlowBuilder.registerStepBuilder(type, builder)`

Register a custom step type. Called when `build()` encounters an unknown `type`.
The builder is responsible for calling the appropriate `FlowBuilder` methods.

```typescript
JsonFlowBuilder.registerStepBuilder("conditional", (step, flow, registry) => {
  // step is the raw config object; call flow methods to wire it up
  flow.then(registry[step.fn], { label: step.label });
});
```

Custom types are also accepted by `validate()` — no "unknown step type" error is raised for registered types.

---

## Examples

### Branch

```typescript
const config = {
  steps: [
    {
      type: "branch",
      router: "routeByScore",
      branches: {
        pass: "publishResult",
        retry: "refineResult",
        fail: "logFailure",
      },
    },
  ],
};
```

### Loop

```typescript
const config = {
  steps: [
    { type: "anchor", name: "refine", maxVisits: 5 },
    { type: "fn", fn: "generateDraft" },
    { type: "fn", fn: "checkScore" }, // returns "#refine" or undefined
    { type: "fn", fn: "publish" },
  ],
};
```

### Batch

```typescript
const config = {
  steps: [
    {
      type: "batch",
      items: "getDocumentList",
      processor: [
        { type: "fn", fn: "summarizeDocument" },
        { type: "fn", fn: "embedDocument" },
      ],
      key: "__currentDoc",
    },
  ],
};
```

### Parallel

```typescript
const config = {
  steps: [
    {
      type: "parallel",
      fns: ["fetchProfile", "fetchOrders", "fetchPreferences"],
      label: "parallel:fetch",
    },
  ],
};
```

---

## Validation errors

```typescript
export interface ValidationError {
  path: string; // dot-path to the problem, e.g. "$.steps[1].branches.fail"
  message: string; // human-readable description
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
```

### `ConfigValidationError`

Thrown by `build()` when validation fails. Contains the full error list.

```typescript
import { ConfigValidationError } from "flowneer/plugins/config";

try {
  const flow = JsonFlowBuilder.build(config, registry);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    // "FlowConfig validation failed:\n  $.steps[0].fn: \"missingFn\" not found in registry"
    console.error(err.errors); // Array<ValidationError>
  }
}
```

---

## Notes

- `JsonFlowBuilder.build()` produces a standard `FlowBuilder` — all plugins, hooks, and methods work normally on the result.
- The registry is **not** validated for unused entries — only referenced keys must exist.
- `registerStepBuilder` is global — registered builders apply to all `JsonFlowBuilder.build()` calls in the process.
