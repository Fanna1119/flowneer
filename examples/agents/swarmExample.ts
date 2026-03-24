// ---------------------------------------------------------------------------
// swarmExample — decentralized customer-support swarm using callLlm
// ---------------------------------------------------------------------------
//
// Four specialist agents collaborate without a central manager.
// A `router` selects the right specialist for each incoming query — no
// dedicated triage agent required. Specialists can still hand off to any
// other agent when a query is outside their domain.
//
//   router → billing    (billing / payment / invoice questions)
//   router → technical  (bug reports, errors, how-to questions)
//   router → general    (everything else)
//   technical → escalation  (account-level issues that need human review)
//   any → any           (mid-conversation handoff via handoffTo())
//
// The `router.call` accepts any function (string → Promise<string>),
// making it easy to swap LLM providers without touching agent logic.
//
// Run with:  bun run examples/agents/swarmExample.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import { swarm, handoffTo, historyText } from "../../presets/agent";
import type { SwarmAgent, SwarmMessage, SwarmState } from "../../presets/agent";
import { callLlm } from "../../utils/callLlm";

// ── Shared state ─────────────────────────────────────────────────────────────

interface SupportState extends SwarmState {
  messages: SwarmMessage[];
}

// ── Agents ───────────────────────────────────────────────────────────────────

const billingAgent: SwarmAgent<SupportState> = {
  name: "billing",
  description: "Handles billing, payment, and subscription questions",
  fn: async (shared) => {
    const history = historyText(shared.messages ?? []);
    const lastUser = [...(shared.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    // Hand back if this isn't actually a billing question
    const isRelevant = await callLlm(
      `${history}\nIs the following message a billing, payment, or subscription question?\nRespond with only "yes" or "no".\nMessage: "${lastUser.content}"`,
    );
    if (isRelevant.trim().toLowerCase().startsWith("n")) {
      handoffTo(shared, "general", "not a billing question");
      return;
    }

    const reply = await callLlm(
      `${history}\nYou are a helpful billing support specialist.\nAnswer the following billing question clearly and concisely.\nIf you need account-specific information you don't have, politely ask for it.\nQuestion: "${lastUser.content}"`,
    );
    shared.messages = [
      ...(shared.messages ?? []),
      { role: "assistant", content: reply, agent: "billing" },
    ];
  },
};

const technicalAgent: SwarmAgent<SupportState> = {
  name: "technical",
  description: "Handles bugs, errors, API questions, and how-to queries",
  fn: async (shared) => {
    const history = historyText(shared.messages ?? []);
    const lastUser = [...(shared.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    // Ask the LLM whether this needs account-level investigation
    const needsEscalation = await callLlm(
      `${history}\nDoes the following technical question require account-level investigation (e.g. server logs, internal tooling, or data access that a support agent can't perform)?\nRespond with only "yes" or "no".\nQuestion: "${lastUser.content}"`,
    );
    if (needsEscalation.trim().toLowerCase().startsWith("y")) {
      handoffTo(shared, "escalation", "requires account-level investigation");
      return;
    }

    const reply = await callLlm(
      `${history}\nYou are a technical support specialist for a software product.\nProvide a clear, step-by-step answer to the following technical question.\nQuestion: "${lastUser.content}"`,
    );
    shared.messages = [
      ...(shared.messages ?? []),
      { role: "assistant", content: reply, agent: "technical" },
    ];
  },
};

const escalationAgent: SwarmAgent<SupportState> = {
  name: "escalation",
  description:
    "Handles issues that require account-level investigation or human review",
  fn: async (shared) => {
    const lastUser = [...(shared.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    // In a real system this would open a ticket, page on-call, etc.
    // Here we just acknowledge and close the loop.
    shared.messages = [
      ...(shared.messages ?? []),
      {
        role: "assistant",
        content:
          "I've escalated your case to our engineering team. You'll receive an update via email within one business day.",
        agent: "escalation",
      },
    ];
  },
};

const generalAgent: SwarmAgent<SupportState> = {
  name: "general",
  description:
    "Handles general support, account questions, and everything else",
  fn: async (shared) => {
    const history = historyText(shared.messages ?? []);
    const lastUser = [...(shared.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    const reply = await callLlm(
      `${history}\nYou are a friendly customer support agent.\nAnswer the following question helpfully and concisely.\nQuestion: "${lastUser.content}"`,
    );
    shared.messages = [
      ...(shared.messages ?? []),
      { role: "assistant", content: reply, agent: "general" },
    ];
  },
};

// ── Swarm setup ───────────────────────────────────────────────────────────────
//
// `router` runs once at the start of each `.run()` call and picks the best
// agent for the incoming query. `router.call` is LLM-agnostic — any function
// with the signature `(prompt: string) => Promise<string>` works here.

const flow = swarm<SupportState>(
  [billingAgent, technicalAgent, escalationAgent, generalAgent],
  {
    defaultAgent: "general",
    maxHandoffs: 4,
    router: {
      call: callLlm, // swap for any LLM adapter
      prompt: ({ agents, messages }) => {
        const agentList = agents
          .map((a) => `- ${a.name}: ${a.description}`)
          .join("\n");
        const history = historyText(messages);
        const latest = [...messages].reverse().find((m) => m.role === "user");
        return [
          "You are a customer-support router.",
          "Choose the best specialist for the user's initial request.",
          "Note: the escalation agent is only for mid-conversation handoffs — do not route directly to it.",
          "",
          "Specialists:",
          agentList,
          "",
          ...(history ? ["Conversation so far:", history, ""] : []),
          ...(latest ? [`Latest message: "${latest.content}"`, ""] : []),
          "Respond with only the specialist name (billing, technical, or general).",
        ].join("\n");
      },
    },
    onHandoff: (from, to, reason) => {
      console.log(
        `  ↳ [handoff] ${from} → ${to}${reason ? ` (${reason})` : ""}`,
      );
    },
    onMaxHandoffs: (shared) => {
      const alreadyAnswered = (shared.messages ?? []).some(
        (m) => m.role === "assistant",
      );
      if (!alreadyAnswered) {
        shared.messages = [
          ...(shared.messages ?? []),
          {
            role: "assistant",
            content:
              "I'm sorry — we weren't able to route your request. Please contact support@example.com.",
            agent: "system",
          },
        ];
      }
    },
  },
);

// ── Demo: run a few queries ───────────────────────────────────────────────────

async function runQuery(question: string): Promise<void> {
  const state: SupportState = {
    messages: [{ role: "user", content: question }],
  };

  console.log(`\nUser: ${question}`);
  await flow.run(state);

  const lastReply = [...(state.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastReply) {
    console.log(`${lastReply.agent ?? "Assistant"}: ${lastReply.content}`);
  }
  console.log(`  (active agent: ${state.currentAgent})`);
}

await runQuery("I was charged twice last month, can you help?");
await runQuery("How do I set up the webhook integration?");
await runQuery(
  "My data was deleted from your servers — I need the logs reviewed.",
);
await runQuery("What are your business hours?");
