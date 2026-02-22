// ---------------------------------------------------------------------------
// Assistant flow — routes a question to either the weather API or a joke
// ---------------------------------------------------------------------------
// Run with: bun run examples/assistantFlow.ts

import { FlowBuilder, FlowError } from "../Flowneer";
import { callLlm } from "../utils/callLlm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AssistantState {
  question: string;
  history: Message[];
  intent?: "weather" | "joke" | "other";
  answer?: string;
}

const flow = new FlowBuilder<AssistantState>()
  // ── 1. Classify the intent ──────────────────────────────────────────────
  .startWith(async (s) => {
    const historyText = s.history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const classification = await callLlm(
      `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}Classify the following user question into exactly one of these categories:
  - "weather"  → if the user is asking about the weather or forecast in any location
  - "joke"     → if the user wants to hear a joke or something funny
  - "other"    → anything else

Respond with ONLY the category word, lowercase, no punctuation.

Question: "${s.question}"`,
    );
    s.intent = classification.trim().toLowerCase() as AssistantState["intent"];
  })
  // ── 2. Branch on intent ─────────────────────────────────────────────────
  .branch((s) => s.intent, {
    weather: async (s) => {
      const historyText = s.history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      s.answer = await callLlm(
        `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}Answer this weather question with a brief, current forecast. Question: "${s.question}"`,
        { webSearch: true },
      );
    },
    joke: async (s) => {
      const historyText = s.history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      s.answer = await callLlm(
        `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}Tell a short, funny joke in response to: "${s.question}"`,
      );
    },
    default: async (s) => {
      const historyText = s.history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      s.answer = await callLlm(
        `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}${s.question}`,
      );
    },
  })
  // ── 3. Print the answer and update history ──────────────────────────────
  .then(async (s) => {
    console.log(`\nIntent   : ${s.intent}`);
    console.log(`Assistant: ${s.answer}\n`);
    s.history.push({ role: "user", content: s.question });
    s.history.push({ role: "assistant", content: s.answer ?? "" });
  });

// ── Interactive prompt loop ─────────────────────────────────────────────────

import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = () =>
  new Promise<string | null>((resolve) => {
    rl.question("You: ", resolve);
    rl.once("close", () => resolve(null));
  });

const history: Message[] = [];

console.log('Ask me anything! (type "exit" or press Ctrl+C to quit)\n');

while (true) {
  const question = await ask();
  if (question === null || question.trim().toLowerCase() === "exit") {
    console.log("Goodbye!");
    rl.close();
    break;
  }
  if (!question.trim()) continue;

  console.log(`You: ${question}`);

  try {
    await flow.run({ question, history, intent: undefined, answer: undefined });
  } catch (err) {
    if (err instanceof FlowError) {
      console.error(`Flow error at [${err.step}]: ${err.message}`);
    } else {
      throw err;
    }
  }
}
