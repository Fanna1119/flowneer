// ---------------------------------------------------------------------------
// Blog Post Generator — multi-agent orchestration example
// ---------------------------------------------------------------------------
// Demonstrates supervisorCrew, roundRobinDebate, sequentialCrew, and
// hierarchicalCrew from plugins/agent/patterns.ts.
//
// Pipeline:
//   1. supervisorCrew  — supervisor creates an outline, workers write each
//                        section in parallel, supervisor assembles the draft
//   2. roundRobinDebate — optimist / critic / synthesiser debate the draft
//                          for 2 rounds to surface improvements
//   3. sequentialCrew  — editor → fact-checker → SEO optimizer polish the post
//   4. hierarchicalCrew — top-level manager orchestrates all three sub-flows
//
// Run with: bun run examples/blogPostGenerator.ts
// Requires: OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "../plugins/agent/patterns";
import { callLlm } from "../utils/callLlm";

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface BlogState {
  topic: string;
  outline: string[];
  sections: Record<string, string>;
  debate: { agent: string; text: string }[];
  draft: string;
  final: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Research + Write — supervisorCrew
//    Supervisor builds outline → workers write each section in parallel →
//    supervisor assembles draft
// ─────────────────────────────────────────────────────────────────────────────

const researchFlow = supervisorCrew<BlogState>(
  // Supervisor: plan the structure
  async (s) => {
    console.log(`\n[Supervisor] Planning outline for: "${s.topic}"`);
    const raw = await callLlm(
      `You are a content strategist. Create a 4-section outline for a blog post about "${s.topic}".
Reply with ONLY a JSON array of 4 short section titles, e.g. ["Introduction", "...","...","Conclusion"].`,
    );
    s.outline = JSON.parse(raw.trim());
    s.sections = {};
    console.log(`[Supervisor] Outline: ${s.outline.join(" → ")}`);
  },
  // Workers: write each section in parallel
  [
    async (s) => {
      const title = s.outline[0]!;
      console.log(`  [Worker 1] Writing "${title}"`);
      s.sections[title] = await callLlm(
        `Write the "${title}" section of a blog post about "${s.topic}". 2–3 paragraphs.`,
      );
    },
    async (s) => {
      const title = s.outline[1]!;
      console.log(`  [Worker 2] Writing "${title}"`);
      s.sections[title] = await callLlm(
        `Write the "${title}" section of a blog post about "${s.topic}". 2–3 paragraphs.`,
      );
    },
    async (s) => {
      const title = s.outline[2]!;
      console.log(`  [Worker 3] Writing "${title}"`);
      s.sections[title] = await callLlm(
        `Write the "${title}" section of a blog post about "${s.topic}". 2–3 paragraphs.`,
      );
    },
    async (s) => {
      const title = s.outline[3]!;
      console.log(`  [Worker 4] Writing "${title}"`);
      s.sections[title] = await callLlm(
        `Write the "${title}" section of a blog post about "${s.topic}". 2–3 paragraphs.`,
      );
    },
  ],
  // Post: assemble sections into a draft
  {
    post: async (s) => {
      s.draft = s.outline
        .map((title) => `## ${title}\n\n${s.sections[title] ?? ""}`)
        .join("\n\n");
      console.log(`[Supervisor] Draft assembled (${s.draft.length} chars)`);
    },
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Debate — roundRobinDebate
//    Optimist defends, Critic challenges, Synthesiser distils improvements.
//    Runs for 2 rounds; final synthesiser output is used to guide editing.
// ─────────────────────────────────────────────────────────────────────────────

const debateFlow = roundRobinDebate<BlogState>(
  [
    async (s) => {
      s.debate ??= [];
      console.log(`  [Optimist] Round ${(s as any).__debateRound + 1}`);
      s.debate.push({
        agent: "optimist",
        text: await callLlm(
          `You are an optimist reviewer. In 2–3 sentences, highlight the strengths of this blog post draft:\n\n${s.draft}`,
        ),
      });
    },
    async (s) => {
      console.log(`  [Critic]   Round ${(s as any).__debateRound + 1}`);
      s.debate.push({
        agent: "critic",
        text: await callLlm(
          `You are a harsh critic. In 2–3 sentences, point out the weaknesses of this blog post draft:\n\n${s.draft}`,
        ),
      });
    },
    async (s) => {
      console.log(`  [Synth]    Round ${(s as any).__debateRound + 1}`);
      const lastTwo = s.debate.slice(-2);
      s.debate.push({
        agent: "synthesiser",
        text: await callLlm(
          `Based on this feedback, suggest the single most important improvement to make:\n\nOptimist: ${lastTwo[0]?.text}\nCritic: ${lastTwo[1]?.text}`,
        ),
      });
    },
  ],
  2, // 2 rounds
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Polish — sequentialCrew
//    Editor rewrites with debate feedback → Fact-checker verifies claims →
//    SEO optimizer adds keywords and meta description
// ─────────────────────────────────────────────────────────────────────────────

const polishFlow = sequentialCrew<BlogState>([
  // Editor: incorporate debate feedback
  async (s) => {
    const improvements = s.debate
      .filter((d) => d.agent === "synthesiser")
      .map((d, i) => `${i + 1}. ${d.text}`)
      .join("\n");
    console.log(`\n[Editor] Revising draft based on debate feedback`);
    s.draft = await callLlm(
      `You are a professional editor. Revise this blog post incorporating these improvements:\n\n${improvements}\n\n---\n\n${s.draft}`,
    );
  },
  // Fact-checker: flag or fix dubious claims
  async (s) => {
    console.log(`[Fact-checker] Reviewing claims`);
    s.draft = await callLlm(
      `You are a fact-checker. Review this blog post and correct any factual inaccuracies. Return the full corrected post.\n\n${s.draft}`,
    );
  },
  // SEO optimizer: add title, meta description, and keywords
  async (s) => {
    console.log(`[SEO] Optimizing for search`);
    s.final = await callLlm(
      `You are an SEO expert. Add an SEO title (prefix with "# "), a meta description (prefix with "> Meta:"), and naturally weave in relevant keywords. Return the full post.\n\n${s.draft}`,
    );
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Orchestrate — hierarchicalCrew
//    Manager kicks things off, runs all three sub-flows, then prints the result
// ─────────────────────────────────────────────────────────────────────────────

const blogFlow = hierarchicalCrew<BlogState>(
  async (s) => {
    console.log("=".repeat(60));
    console.log(`Blog Post Generator`);
    console.log(`Topic: "${s.topic}"`);
    console.log("=".repeat(60));
  },
  [researchFlow, debateFlow, polishFlow],
  async (s) => {
    console.log("\n" + "=".repeat(60));
    console.log("FINAL BLOG POST");
    console.log("=".repeat(60));
    console.log(s.final);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

await blogFlow.run({
  topic: "Why Dogs Are Better Than Cats",
  outline: [],
  sections: {},
  debate: [],
  draft: "",
  final: "",
});
