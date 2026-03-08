// ---------------------------------------------------------------------------
// RAG Presets — ragPipeline and iterativeRag
// ---------------------------------------------------------------------------
//
// Simulates a vector store with a simple keyword-match stub so the example
// runs without any external embedding service.
//
//   1. ragPipeline   — retrieve → LLM rerank → generate (single pass)
//   2. iterativeRag  — retrieve → generate → follow-up retrieval if needed
//
// Run with:  bun run examples/ragExample.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { callLlm } from "../../utils/callLlm";
import { ragPipeline, iterativeRag } from "../../presets/rag";

// ─────────────────────────────────────────────────────────────────────────────
// Stub vector store — keyword-match over an in-memory corpus
// ─────────────────────────────────────────────────────────────────────────────

const DOCS = [
  "Flowneer is a zero-dependency fluent flow builder for AI agents.",
  "FlowBuilder supports sequential, parallel, loop, branch, and batch steps.",
  "Plugins extend FlowBuilder via prototype augmentation using FlowBuilder.use().",
  "Presets are higher-level factories that compose plugins into reusable patterns.",
  "The ReAct loop preset implements think → tool-call → observation cycles.",
  "The RAG preset wires retrieve → augment → generate in three lines.",
  "withMemory attaches a Memory instance to shared.__memory before the flow starts.",
  "withTools registers a ToolRegistry on shared.__tools for use by agent loops.",
];

function vectorSearch(query: string, topK = 3): string[] {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  return DOCS.map((doc) => ({
    doc,
    score: words.filter((w) => doc.toLowerCase().includes(w)).length,
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => r.doc);
}

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}\n ${title}\n${"─".repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ragPipeline — retrieve → LLM rerank → generate
// ─────────────────────────────────────────────────────────────────────────────

interface RagState {
  query: string;
  context: string[];
  answer: string;
}

const singleShotFlow = ragPipeline<RagState>({
  retrieve: async (s) => {
    console.log(`  [retrieve] "${s.query}"`);
    s.context = vectorSearch(s.query, 5);
    console.log(`  [retrieve] ${s.context.length} candidate docs`);
  },

  // Rerank: ask LLM to keep only the 2 most relevant passages
  augment: async (s) => {
    console.log("  [augment]  Reranking…");
    const raw = await callLlm(
      `From these passages, return the indices (0-based) of the 2 most relevant to: "${s.query}"
Reply ONLY with a JSON array of 2 numbers.

${s.context.map((c, i) => `${i}: ${c}`).join("\n")}`,
    );
    const indices: number[] = JSON.parse(raw.trim());
    s.context = indices.map((i) => s.context[i]!);
    console.log(
      `  [augment]  Kept ${s.context.length} passages after reranking`,
    );
  },

  generate: async (s) => {
    console.log("  [generate] Answering…");
    s.answer = await callLlm(
      `Answer using ONLY the context below. Be concise.

Context:
${s.context.map((c) => `• ${c}`).join("\n")}

Question: ${s.query}`,
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. iterativeRag — follow-up retrieval when more context is needed
// ─────────────────────────────────────────────────────────────────────────────

interface IterativeState {
  question: string;
  context: string[];
  answer: string;
  followUpQuery?: string;
  __ragIter?: number;
}

const multiShotFlow = iterativeRag<IterativeState>({
  retrieve: async (s) => {
    const query =
      (s.__ragIter ?? 0) === 0 ? s.question : (s.followUpQuery ?? s.question);
    console.log(`  [retrieve] Iter ${s.__ragIter ?? 0}: "${query}"`);
    const fresh = vectorSearch(query, 2);
    // Accumulate context across iterations, deduplicating
    s.context = [...new Set([...(s.context ?? []), ...fresh])];
  },

  generate: async (s) => {
    console.log("  [generate] Drafting answer…");
    const raw = await callLlm(
      `Answer the question as completely as you can from the context.
If you still need information on a specific topic to answer fully, add "NEED: <topic>" on the very last line.

Context:
${s.context.map((c) => `• ${c}`).join("\n")}

Question: ${s.question}`,
    );
    const lines = raw.trim().split("\n");
    const needLine = lines.find((l) => l.startsWith("NEED:"));
    s.followUpQuery = needLine
      ? needLine.replace("NEED:", "").trim()
      : undefined;
    s.answer = lines
      .filter((l) => !l.startsWith("NEED:"))
      .join("\n")
      .trim();
    if (s.followUpQuery) {
      console.log(`  [generate] Needs more info on: "${s.followUpQuery}"`);
    }
  },

  needsMoreInfo: (s) => Boolean(s.followUpQuery),
  maxIterations: 3,
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

separator("1. ragPipeline — retrieve → rerank → generate");
const ragState: RagState = {
  query: "How do Flowneer plugins extend the FlowBuilder?",
  context: [],
  answer: "",
};
await singleShotFlow.run(ragState);
console.log("\nAnswer:\n" + ragState.answer);

separator("2. iterativeRag — follow-up retrieval loop");
const iterState: IterativeState = {
  question:
    "What are presets in Flowneer, how do they differ from plugins, and what patterns do they provide?",
  context: [],
  answer: "",
};
await multiShotFlow.run(iterState);
console.log("\nAnswer:\n" + iterState.answer);
