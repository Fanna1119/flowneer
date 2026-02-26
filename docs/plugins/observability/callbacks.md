# withCallbacks

Register expanded lifecycle callbacks dispatched based on step label prefixes. Provides LangChain-style `onLLMStart`, `onToolEnd`, etc. without modifying core.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCallbacks } from "flowneer/plugins/observability";

FlowBuilder.use(withCallbacks);
```

## Usage

```typescript
const flow = new FlowBuilder<State>()
  .withCallbacks({
    onLLMStart: (meta) => console.log(`LLM step ${meta.index} starting`),
    onLLMEnd: (meta, s) => console.log(`LLM done, tokens: ${s.tokensUsed}`),
    onToolStart: (meta) => console.log(`Tool ${meta.label} starting`),
    onToolEnd: (meta, s) => console.log(`Tool done`),
    onChainStart: (meta) => console.log(`Step ${meta.index} starting`),
    onError: (meta, err) => console.error(`Step ${meta.index} failed`, err),
  })
  .startWith(async (s) => {
    /* chain step */
  })
  .then(myLlmStep); // label this step "llm:generate" to trigger onLLMStart/End
```

## Callback Dispatch by Label Prefix

The callback invoked depends on the `label` field in `StepMeta`:

| Label prefix              | `beforeStep` callback | `afterStep` callback |
| :------------------------ | :-------------------- | :------------------- |
| `"llm:*"`                 | `onLLMStart`          | `onLLMEnd`           |
| `"tool:*"`                | `onToolStart`         | `onToolEnd`          |
| `"agent:*"`               | `onAgentAction`       | `onAgentFinish`      |
| _(anything else or none)_ | `onChainStart`        | `onChainEnd`         |

## Setting Step Labels

Labels are set via `NodeOptions` (not yet exposed as a first-class API in core — forward-looking feature):

```typescript
// Convention: combine with a plugin that sets meta.label
```

> Currently labels are set internally by plugins like `withTools` and `withReActLoop`. You can set `meta.label` via a custom `wrapStep` or a `beforeStep` hook in your own plugin.

## All Callback Handlers

```typescript
interface CallbackHandlers<S, P> {
  onLLMStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onLLMEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onToolStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onToolEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onAgentAction?: (
    meta: StepMeta,
    shared: S,
    params: P,
  ) => void | Promise<void>;
  onAgentFinish?: (
    meta: StepMeta,
    shared: S,
    params: P,
  ) => void | Promise<void>;
  onChainStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onChainEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onError?: (meta: StepMeta, error: unknown, shared: S, params: P) => void;
}
```

All callbacks are optional. Only those for which a handler is registered will be called.
