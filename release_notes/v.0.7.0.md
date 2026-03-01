# v0.7.0

## New features

### `createAgent()` + `tool()` — LangChain-style agent factory

A high-level factory API for building tool-calling agents without any boilerplate. Import from `flowneer/plugins/agent`.

```typescript
import { tool, createAgent } from "flowneer/plugins/agent";

const getWeather = tool(({ city }) => `Sunny in ${city}!`, {
  name: "get_weather",
  description: "Get the weather for a given city",
  schema: z.object({ city: z.string() }), // Zod or plain params
});

const agent = createAgent({
  tools: [getWeather],
  callLlm: myOpenAiAdapter,
  systemPrompt: "You are a helpful assistant.",
});

const state = { input: "Weather in Paris?", messages: [] };
await agent.run(state);
console.log(state.output);
```

**`tool()` factory**

- Accepts a Zod-compatible `schema` **or** plain `params: Record<string, ToolParam>` — both styles produce an identical `Tool` object
- Zod schemas are duck-typed (no direct Zod import required in Flowneer itself)
- Full TypeScript inference on `execute` argument types

**`createAgent()` factory**

- Returns a `FlowBuilder<AgentState>` — fully composable with other plugins
- Wires `withTools` + `withReActLoop` internally; no `FlowBuilder.use()` calls needed
- `callLlm` is a vendor-agnostic adapter — wire OpenAI, Anthropic, or any provider
- Conversation history (`state.messages`) is maintained across tool-call turns
- `systemPrompt` can be passed to the factory or set per-run via `state.systemPrompt`
- Agent instances are reusable across multiple `.run()` calls

See [docs/plugins/agent/create-agent.md](../docs/plugins/agent/create-agent.md) for the full API reference.

---

### `withExportGraph` — graph node/edge export

Export the declared nodes and edges of a `withGraph` flow as a JSON-serialisable object — without compiling the flow.

```typescript
import { withExportGraph } from "flowneer/plugins/graph";
FlowBuilder.use(withGraph);
FlowBuilder.use(withExportGraph);

const result = flow
  .addNode("fetch", fetchData)
  .addNode("save", saveData)
  .addEdge("fetch", "save")
  .exportGraph(); // non-destructive — .compile() can still be called after

// result: { format: "json", nodes: [...], edges: [...] }
```

- Returns `GraphExport: { format, nodes, edges }`
- `conditional: true` on edges that have a runtime guard function
- Non-destructive: `.compile()` can still be chained after `.exportGraph()`
- `"mermaid"` format is reserved for a future release

---

### `withExportFlow` — full sequential flow export

Export any `FlowBuilder` — sequential, loop, batch, parallel, branch — as a structured graph for debugging or visualisation. Supersedes `withExportGraph` when both are loaded.

```typescript
import { withExportFlow } from "flowneer/plugins/graph";
FlowBuilder.use(withExportFlow);

const result = flow.exportGraph();
// result: { format: "json", flow: { nodes, edges }, graph?: { nodes, edges } }
```

- Works on **any** `FlowBuilder`, not just graph-compiled ones
- Recursively walks `loop`, `batch`, `branch`, and `parallel` sub-flows, producing nested `id` paths (`"loop_2:body:fn_0"`)
- When loaded alongside `withGraph`, includes both a `flow` section (compiled steps) and a `graph` section (raw declared nodes/edges)
- Step types exported: `fn`, `branch`, `loop`, `batch`, `parallel`, `anchor`
- Non-default options (retries, delaySec, timeoutMs) appear as `options` on each node

See [docs/plugins/graph/export.md](../docs/plugins/graph/export.md) for the full API reference.

---

## Tests

- `test/createAgent.test.ts` — 21 tests covering `tool()` factories (both Zod and plain params) and `createAgent()` end-to-end flows including tool-calling loop, error handling, `maxIterations` exhaustion, and reusability

## Bug fixes

_None_

## Breaking changes

_None_
