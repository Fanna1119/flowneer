# swarm

Decentralized multi-agent preset where any agent can hand off to any other agent at runtime. Unlike `supervisorCrew` or `hierarchicalCrew`, there is no central manager — routing emerges from the agents' own logic.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { swarm, handoffTo, historyText } from "flowneer/presets/agent";
import type {
  SwarmAgent,
  SwarmState,
  SwarmOptions,
  RouterContext,
  SwarmRouter,
} from "flowneer/presets/agent";
```

---

## Quick start

```typescript
interface MyState extends SwarmState {
  messages: { role: "user" | "assistant"; content: string; agent?: string }[];
}

const triageAgent: SwarmAgent<MyState> = {
  name: "triage",
  description: "Routes incoming requests to the right specialist",
  fn: async (shared) => {
    const topic = classifyMessage(shared.messages);
    if (topic === "billing") {
      handoffTo(shared, "billing", "billing question detected");
    } else {
      handoffTo(shared, "support");
    }
  },
};

const billingAgent: SwarmAgent<MyState> = {
  name: "billing",
  description: "Handles billing and payment queries",
  fn: async (shared) => {
    const reply = await billingLlm(shared.messages);
    shared.messages.push({
      role: "assistant",
      content: reply,
      agent: "billing",
    });
    // No handoffTo → turn ends here
  },
};

const supportAgent: SwarmAgent<MyState> = {
  name: "support",
  description: "General customer support",
  fn: async (shared) => {
    const reply = await supportLlm(shared.messages);
    shared.messages.push({
      role: "assistant",
      content: reply,
      agent: "support",
    });
  },
};

const flow = swarm([triageAgent, billingAgent, supportAgent], {
  defaultAgent: "triage",
});

await flow.run({
  messages: [{ role: "user", content: "I was charged twice last month" }],
});
```

---

## `handoffTo(shared, agentName, reason?)`

Call `handoffTo` inside any agent's `fn` to request a handoff to another agent.

```typescript
// yield to another agent
handoffTo(shared, "billing");

// with an optional reason (available in onHandoff callback)
handoffTo(shared, "billing", "bill-related query");
```

- If `agentName` is not in the swarm the handoff is silently dropped and the turn ends.
- Only one handoff per agent invocation is honoured — set `__swarmHandoff` is only read once per loop iteration.

---

## Shared state

`swarm()` reads and writes the following fields on `shared`. Declare them in your state type using `SwarmState`:

| Field            | Type                          | Description                                                                        |
| ---------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `currentAgent`   | `string \| undefined`         | Name of the agent that will run next. Set to `defaultAgent` on the very first run. |
| `messages`       | `SwarmMessage[] \| undefined` | Conversation history — managed by your agent fns.                                  |
| `turnCount`      | `number \| undefined`         | Number of handoffs accepted in the current `.run()` call. Reset to `0` each run.   |
| `__swarmHandoff` | `{ target, reason? }`         | **Internal** — set by `handoffTo`, consumed by the loop. Never read this directly. |
| `__swarmDone`    | `boolean`                     | **Internal** — loop-exit sentinel. Deleted after each run.                         |

`currentAgent` **persists between `.run()` calls** — the swarm remembers which agent last had control. This supports multi-turn conversations where the same specialist handles follow-up messages.

---

## `swarm(agents, options)` — signature

```typescript
function swarm<S extends SwarmState, P>(
  agents: SwarmAgent<S, P>[],
  options: SwarmOptions<S>,
): FlowBuilder<S, P>;
```

---

## `SwarmAgent<S, P>`

```typescript
interface SwarmAgent<S, P> {
  name: string; // unique identifier used in handoffTo()
  description: string; // human-readable; can be injected into an LLM prompt
  fn: NodeFn<S, P>; // standard Flowneer step function
}
```

---

## `SwarmOptions<S>`

| Option          | Type                                                  | Default | Description                                              |
| --------------- | ----------------------------------------------------- | ------- | -------------------------------------------------------- |
| `defaultAgent`  | `string`                                              | —       | **Required.** Starting agent on first `.run()`.          |
| `maxHandoffs`   | `number`                                              | `5`     | Max hops per `.run()` call. The first agent run is free. |
| `onHandoff`     | `(from, to, reason, shared) => void \| Promise<void>` | —       | Called on every accepted handoff.                        |
| `onMaxHandoffs` | `(shared) => void \| Promise<void>`                   | —       | Called instead of the handoff when the limit is reached. |

`swarm()` throws at **construction time** if `defaultAgent` is not in the `agents` array.

### `onHandoff` example

Use `onHandoff` for observability, audit logging, or side-effects triggered on every accepted handoff:

```typescript
const flow = swarm(agents, {
  defaultAgent: "triage",
  onHandoff: async (from, to, reason, shared) => {
    // Structured audit log
    console.log(
      JSON.stringify({
        event: "swarm_handoff",
        from,
        to,
        reason,
        turnCount: shared.turnCount,
        messageCount: shared.messages?.length ?? 0,
        ts: Date.now(),
      }),
    );

    // Optionally append a system note to the conversation history
    shared.messages?.push({
      role: "assistant",
      content: `[Transferring you to the ${to} team${reason ? ` — ${reason}` : ""}]`,
      agent: "system",
    });
  },
});
```

`onHandoff` fires **before** `turnCount` is incremented and **before** `currentAgent` is updated to the new agent. This means `shared.currentAgent` still points to the agent that is handing off, and `shared.turnCount` reflects the number of hops accepted so far (not including this one).

---

## LLM router

Pass a `router` object in `SwarmOptions` to let an LLM choose the starting agent on each `.run()` call. The router runs **once per run**, before the handoff loop begins.

| Option   | Type                                                               | Description                                           |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `call`   | `(prompt: string) => Promise<string>`                              | **Required.** Calls the LLM and returns a raw string. |
| `prompt` | `string \| ((ctx: RouterContext<S>) => string \| Promise<string>)` | Custom prompt. Defaults to a built-in routing prompt. |

```typescript
import { swarm } from "flowneer/presets/agent";
import OpenAI from "openai";

const client = new OpenAI();

const flow = swarm(agents, {
  defaultAgent: "triage",
  router: {
    call: async (prompt) => {
      const res = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0].message.content ?? "";
    },
  },
});
```

### Custom prompt

Supply `prompt` as an async function to build context-aware routing prompts:

```typescript
const flow = swarm(agents, {
  defaultAgent: "triage",
  router: {
    call: myLlm,
    prompt: async ({ messages, agents }) => {
      const agentList = agents
        .map((a) => `- ${a.name}: ${a.description}`)
        .join("\n");
      const latest = messages.at(-1)?.content ?? "(none)";
      return `Pick the best agent for this message.\n\nAgents:\n${agentList}\n\nLatest message:\n${latest}\n\nRespond with only the agent name.`;
    },
  },
});
```

`RouterContext<S>` fields:

| Field          | Type              | Description                                           |
| -------------- | ----------------- | ----------------------------------------------------- |
| `messages`     | `SwarmMessage[]`  | Conversation history at the time of routing.          |
| `agents`       | `SwarmAgent<S>[]` | All agents registered in the swarm.                   |
| `currentAgent` | `string`          | Fallback agent if the router returns an unknown name. |
| `shared`       | `S`               | Live shared state — mutations are visible downstream. |

> **Note:** The router response is trimmed and matched **case-insensitively** against agent names. An unrecognised response is silently ignored and `currentAgent` remains unchanged.

---

## `historyText(messages)`

Utility that formats a `SwarmMessage[]` into a plain-text string for use in LLM prompts.

```typescript
historyText(messages: SwarmMessage[]): string
```

Each message is formatted as `[agentName] role: content`; the `[agentName]` prefix is omitted when `message.agent` is undefined.

```typescript
import { historyText } from "flowneer/presets/agent";

const billingAgent: SwarmAgent<MyState> = {
  name: "billing",
  description: "Handles billing queries",
  fn: async (shared) => {
    const history = historyText(shared.messages ?? []);
    const reply = await myLlm(`${history}\nAnswer the billing question.`);
    shared.messages?.push({
      role: "assistant",
      content: reply,
      agent: "billing",
    });
  },
};
```

---

## Lifecycle per `.run()` call

```
init (set currentAgent if unset, reset turnCount)
│
└─ loop while !done
   ├─ dispatch → agent.fn(shared, params)
   └─ handoff check
        ├─ no __swarmHandoff  →  done = true
        ├─ unknown target     →  done = true
        ├─ turnCount ≥ max    →  onMaxHandoffs()  →  done = true
        └─ accepted           →  onHandoff()  →  turnCount++  →  update currentAgent
│
cleanup (delete __swarmDone)
```

---

## Max-handoffs behaviour

```typescript
const flow = swarm(agents, {
  defaultAgent: "triage",
  maxHandoffs: 3,
  onMaxHandoffs: async (shared) => {
    shared.messages!.push({
      role: "assistant",
      content: "Sorry, we couldn't route your request. Please try again.",
    });
  },
});
```

When `turnCount` reaches `maxHandoffs` the requested handoff is rejected, `onMaxHandoffs` is called, and the turn ends. The `currentAgent` is **not** updated — the agent that tried to hand off remains active for the next `.run()` call.

---

## Internal step labels

Every internal step in `swarm()` carries a stable `swarm:*` label, making them individually targetable via `StepFilter`:

| Label            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `swarm:init`     | Per-run init — sets `currentAgent` if unset, resets `turnCount` |
| `swarm:router`   | Optional LLM router step (no-op when `router` is not set)       |
| `swarm:loop`     | The handoff loop itself                                         |
| `swarm:dispatch` | Agent `fn` invocation — fires once per loop iteration           |
| `swarm:handoff`  | Handoff check, `onHandoff` / `onMaxHandoffs` callbacks          |
| `swarm:cleanup`  | Cleanup — deletes `__swarmDone` after the loop exits            |

```typescript
import { withTiming } from "flowneer/plugins/observability";

const AppFlow = FlowBuilder.extend([withTiming]);
const flow = swarm(agents, { defaultAgent: "triage" }, AppFlow);

(flow as InstanceType<typeof AppFlow>).withTiming(["swarm:dispatch"]); // only time agent fn calls
// .withTiming(["swarm:*"])         // time every internal step
// .withTiming(["!swarm:*"])        // exclude all swarm internals
```

---

## Internal step labels

Every internal step in `swarm()` carries a stable `swarm:*` label that appears in `StepMeta` (error messages, `beforeStep`/`afterStep` hooks):

| Label            | Description                              | Reachable via outer hooks |
| ---------------- | ---------------------------------------- | ------------------------- |
| `swarm:init`     | Per-run initialisation                   | ✅ yes                    |
| `swarm:router`   | Optional LLM router call                 | ✅ yes                    |
| `swarm:loop`     | Handoff loop (the `.loop()` step itself) | ✅ yes                    |
| `swarm:dispatch` | Agent function invocation                | ❌ loop-body only         |
| `swarm:handoff`  | Handoff resolution                       | ❌ loop-body only         |
| `swarm:cleanup`  | Post-loop cleanup                        | ✅ yes                    |

`swarm:dispatch` and `swarm:handoff` run inside the loop body's own `FlowBuilder` instance. Plugins and `StepFilter` registered on the outer flow (via the `FlowClass` parameter) can target `swarm:init`, `swarm:router`, `swarm:loop`, and `swarm:cleanup`. The inner steps still carry their labels and appear correctly in error messages — they are just not reached by hooks on the outer flow.

```ts
const AppFlow = FlowBuilder.extend([
  withTiming(["swarm:loop", "swarm:router"]),
]);
const flow = swarm(agents, options, AppFlow);
flow.withTiming(); // times the loop + router steps
```

---

## Composing with plugins

Pass a `FlowBuilder.extend()` subclass as the optional third argument to apply plugins to the swarm's internal steps:

```typescript
import { withTiming } from "flowneer/plugins/observability";
import { withRateLimit } from "flowneer/plugins/llm";

const AppFlow = FlowBuilder.extend([withTiming, withRateLimit]);

const flow = swarm(agents, { defaultAgent: "triage" }, AppFlow);

(flow as InstanceType<typeof AppFlow>)
  .withTiming()
  .withRateLimit({ intervalMs: 500 });

await flow.run(shared);
```

Plugin hooks (`beforeStep`, `afterStep`, etc.) will fire on every internal swarm step — the init, router, each agent dispatch, the handoff check, and the cleanup.

---

## Providing agent descriptions to LLMs

The `description` field on each `SwarmAgent` is intentionally available for use inside your agent fns — for example, to build a routing prompt:

```typescript
const agents = [triageAgent, billingAgent, supportAgent];
const agentMenu = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");

const triageAgent: SwarmAgent<MyState> = {
  name: "triage",
  description: "Routes incoming requests to the right specialist",
  fn: async (shared) => {
    const target = await routerLlm(shared.messages, agentMenu);
    handoffTo(shared, target, "routed by triage");
  },
};
```
