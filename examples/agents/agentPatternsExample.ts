// ---------------------------------------------------------------------------
// Agent Patterns — reflexion, plan-and-execute, evaluator-optimizer,
//                  self-consistency, critique-and-revise
// ---------------------------------------------------------------------------
//
// Demonstrates the five new patterns from presets/agent/patterns.ts.
//
//   1. reflexionAgent       — code generator that self-critiques and rewrites
//   2. planAndExecute       — researcher that plans then executes each step
//   3. evaluatorOptimizer   — essay writer with a scorer that loops until good
//   4. selfConsistency      — answers a maths problem 5× and majority-votes
//   5. critiqueAndRevise    — two-agent writer/editor loop
//
// Run with:  bun run examples/agentPatternsExample.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { callLlm } from "../../utils/callLlm";
import {
  reflexionAgent,
  planAndExecute,
  evaluatorOptimizer,
  selfConsistency,
  critiqueAndRevise,
} from "../../presets/agent/patterns";

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}\n ${title}\n${"─".repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. reflexionAgent — self-critiquing code generator
//    Generate a function → critique it → revise until "LGTM" or maxIterations
// ─────────────────────────────────────────────────────────────────────────────

interface CodeState {
  task: string;
  code: string;
  __reflexionFeedback?: string | null;
}

const codeGeneratorFlow = reflexionAgent<CodeState>({
  generate: async (s) => {
    const hint = s.__reflexionFeedback
      ? `\nPrevious issues to fix:\n${s.__reflexionFeedback}`
      : "";
    console.log(`  [generate] ${hint ? "Revising…" : "First attempt…"}`);
    s.code = await callLlm(
      `Write a TypeScript function for: ${s.task}${hint}
Return ONLY the function code, no markdown fences.`,
    );
  },
  critique: async (s) => {
    console.log("  [critique] Reviewing code…");
    const verdict = await callLlm(
      `Review this TypeScript function for correctness and edge-cases.
If it looks good, reply with exactly: LGTM
Otherwise reply with 1-2 sentences describing what to fix.

\`\`\`ts
${s.code}
\`\`\``,
    );
    const clean = verdict.trim();
    return clean === "LGTM" ? null : clean;
  },
  maxIterations: 3,
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. planAndExecute — research pipeline
//    Planner breaks a question into sub-tasks; executor runs each one
// ─────────────────────────────────────────────────────────────────────────────

interface ResearchState {
  question: string;
  plan: string[];
  results: string[];
  summary: string;
  __planStep?: string;
}

const researchFlow = planAndExecute<ResearchState>({
  plan: async (s) => {
    console.log("  [planner] Creating research plan…");
    const raw = await callLlm(
      `Break this question into 3 specific sub-questions that together will answer it:
"${s.question}"
Reply with ONLY a JSON array of 3 strings.`,
    );
    s.plan = JSON.parse(raw.trim());
    s.results = [];
    console.log(`  [planner] ${s.plan.join(" | ")}`);
  },
  execute: async (s) => {
    console.log(`  [executor] "${s.__planStep}"`);
    const answer = await callLlm(
      `Answer this specific question concisely (2-3 sentences): ${s.__planStep}`,
    );
    s.results.push(`Q: ${s.__planStep}\nA: ${answer}`);
  },
  getPlan: (s) => s.plan,
});

researchFlow.then(async (s) => {
  console.log("  [synthesise] Writing final summary…");
  s.summary = await callLlm(
    `Summarise these research findings into one paragraph that answers: "${s.question}"\n\n${s.results.join("\n\n")}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. evaluatorOptimizer — scored essay writer
//    Generate an essay → score it → regenerate with feedback if score < 0.8
// ─────────────────────────────────────────────────────────────────────────────

interface EssayState {
  prompt: string;
  essay: string;
  __eoFeedback?: string;
  __eoScore?: number;
}

const essayFlow = evaluatorOptimizer<EssayState>({
  generate: async (s) => {
    const hint = s.__eoFeedback ? `\nImprove based on: ${s.__eoFeedback}` : "";
    console.log(
      `  [generate] ${hint ? "Re-writing with feedback…" : "First draft…"}`,
    );
    s.essay = await callLlm(
      `Write a clear, compelling 2-paragraph essay on: ${s.prompt}${hint}`,
    );
  },
  evaluate: async (s) => {
    console.log("  [evaluate] Scoring essay…");
    const raw = await callLlm(
      `Score this essay 0.0–1.0 for clarity, depth, and engagement.
Reply ONLY with JSON: { "score": <number>, "feedback": "<one sentence>" }

Essay:
${s.essay}`,
    );
    const { score, feedback } = JSON.parse(raw.trim());
    console.log(`  [evaluate] Score: ${score.toFixed(2)} — ${feedback}`);
    return { score, feedback };
  },
  threshold: 0.8,
  maxIterations: 3,
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. selfConsistency — majority-vote on a reasoning question
//    Run the same problem 5× in parallel, then pick the most common answer
// ─────────────────────────────────────────────────────────────────────────────

interface MathState {
  question: string;
  answers: string[];
  answer: string;
}

const mathFlow = selfConsistency<MathState>(
  async (s) => {
    const raw = await callLlm(
      `Solve step by step, then print ONLY the final numeric answer on the last line:\n${s.question}`,
    );
    const lines = raw.trim().split("\n").filter(Boolean);
    s.answers = [...(s.answers ?? []), lines.at(-1)!.trim()];
  },
  5,
  (drafts, shared) => {
    shared.answers = drafts.flatMap((d) => d.answers ?? []);
    const counts = new Map<string, number>();
    for (const a of shared.answers) counts.set(a, (counts.get(a) ?? 0) + 1);
    shared.answer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    console.log(
      `  [vote] ${[...counts.entries()].map(([k, v]) => `${k}×${v}`).join(", ")} → ${shared.answer}`,
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. critiqueAndRevise — writer + editor agent loop
//    Writer drafts content → Editor critiques → Writer revises (2 rounds)
// ─────────────────────────────────────────────────────────────────────────────

interface ArticleState {
  topic: string;
  draft: string;
  critique: string;
}

const articleFlow = critiqueAndRevise<ArticleState>(
  async (s) => {
    console.log("  [writer] Writing first draft…");
    s.draft = await callLlm(
      `Write a punchy 3-sentence news article intro about: ${s.topic}`,
    );
  },
  async (s) => {
    const round = ((s as any).__critiqueRound ?? 0) + 1;
    console.log(`  [editor] Critiquing (round ${round})…`);
    s.critique = await callLlm(
      `You are a tough news editor. Give exactly 2 specific improvement notes for this intro. Be brief.\n\n${s.draft}`,
    );
    console.log(`  [editor] ${s.critique.replace(/\n/g, " | ")}`);
  },
  async (s) => {
    console.log("  [writer] Revising…");
    s.draft = await callLlm(
      `Revise this news intro based on the editor notes. Return ONLY the revised text.\n\nNotes:\n${s.critique}\n\nOriginal:\n${s.draft}`,
    );
  },
  2,
);

// ─────────────────────────────────────────────────────────────────────────────
// Run all five
// ─────────────────────────────────────────────────────────────────────────────

separator("1. reflexionAgent — self-critiquing code generator");
const codeState: CodeState = {
  task: "debounce a function call by N milliseconds",
  code: "",
};
await codeGeneratorFlow.run(codeState);
console.log("\nFinal code:\n" + codeState.code);

separator("2. planAndExecute — research pipeline");
const researchState: ResearchState = {
  question: "What are the main trade-offs between SQL and NoSQL databases?",
  plan: [],
  results: [],
  summary: "",
};
await researchFlow.run(researchState);
console.log("\nSummary:\n" + researchState.summary);

separator("3. evaluatorOptimizer — scored essay writer");
const essayState: EssayState = {
  prompt: "Why open-source software matters for innovation",
  essay: "",
};
await essayFlow.run(essayState);
console.log(
  `\nFinal score: ${essayState.__eoScore?.toFixed(2)}\n` + essayState.essay,
);

separator("4. selfConsistency — majority-vote reasoning");
const mathState: MathState = {
  question:
    "A train goes 120 km at 60 km/h then 80 km at 40 km/h. What is the average speed for the whole journey?",
  answers: [],
  answer: "",
};
await mathFlow.run(mathState);
console.log(`\nMajority answer: ${mathState.answer}`);

separator("5. critiqueAndRevise — writer + editor loop");
const articleState: ArticleState = {
  topic:
    "a new study shows that walking 20 minutes a day extends lifespan by 3 years",
  draft: "",
  critique: "",
};
await articleFlow.run(articleState);
console.log("\nFinal draft:\n" + articleState.draft);
