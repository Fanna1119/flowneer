// ---------------------------------------------------------------------------
// Flowneer — Streaming Server Example
// ---------------------------------------------------------------------------
// Demonstrates how to wire Flowneer's withStream plugin to a live Bun HTTP
// server so that every `emit()` call inside a step is pushed to the client
// in real-time over a persistent HTTP connection.
//
// Two endpoints are served on port 3000:
//
//   GET /stream   — newline-delimited JSON (chunked transfer)
//   GET /events   — Server-Sent Events (EventSource-compatible)
//
// The flow itself is a simulated document-processing pipeline:
//
//   validate → split into sections → [batch] analyse each section
//            → loop refinement while score < threshold → summarise
//
// Each step emits a typed StreamChunk so clients receive granular progress
// without polling.  No OPENAI_API_KEY is required; work is simulated with
// Bun.sleep().  To enable real LLM calls, set USE_LLM=1 and OPENAI_API_KEY.
//
// Run:   bun run examples/streamingServer.ts
// Test:  curl -N http://localhost:3000/stream
//        curl -N -H "Accept: text/event-stream" http://localhost:3000/events
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import { withStream, emit } from "../plugins/messaging/withStream";
import { withTiming } from "../plugins/observability";

// ── Plugin registration ───────────────────────────────────────────────────────

FlowBuilder.use(withStream);
FlowBuilder.use(withTiming);

// ── Stream chunk types ────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: "start"; topic: string }
  | { type: "sections"; count: number; titles: string[] }
  | { type: "section:begin"; index: number; title: string }
  | { type: "section:done"; index: number; title: string; wordCount: number }
  | { type: "refine"; round: number; score: number }
  | { type: "summary"; text: string }
  | { type: "done"; totalMs: number; score: number };

// ── Shared state ──────────────────────────────────────────────────────────────

interface DocState {
  topic: string;
  sections: string[];
  analysed: { title: string; body: string }[];
  score: number;
  refinementRound: number;
  summary: string;
  // set by batch machinery
  __batchItem?: string;
  // set by withTiming
  __timings?: Record<number, number>;
  // set by withStream
  __stream?: (chunk: unknown) => void;
}

// ── Simulated work helpers ────────────────────────────────────────────────────

/** Return pseudo-random ms in [min, max] to simulate variable network latency. */
function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Very cheap LLM simulator — returns canned text after a realistic delay.
 * When USE_LLM=1 and OPENAI_API_KEY is set, uses the real OpenAI API instead.
 */
async function generate(prompt: string): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    const { callLlm } = await import("../utils/callLlm");
    return callLlm(prompt);
  }
  await Bun.sleep(jitter(120, 350));
  // Return something vaguely related to the prompt so logs look meaningful
  const seed = prompt.slice(0, 40).replace(/\W/g, " ").trim();
  return `[simulated output for: "${seed}…"]`;
}

// ── Step functions ────────────────────────────────────────────────────────────

async function validateAndStart(s: DocState): Promise<void> {
  s.topic = s.topic.trim() || "the future of renewable energy";
  emit<StreamChunk>(s, { type: "start", topic: s.topic });
  await Bun.sleep(50);
}

async function splitIntoSections(s: DocState): Promise<void> {
  const raw = await generate(
    `List 4 section titles for a short document about: "${s.topic}". One per line, no numbering.`,
  );

  s.sections = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);

  // Ensure we always have exactly 4 sections even when the LLM is simulated
  if (s.sections.length < 4) {
    s.sections = [
      `Introduction to ${s.topic}`,
      `Key developments`,
      `Challenges and opportunities`,
      `Future outlook`,
    ];
  }

  emit<StreamChunk>(s, {
    type: "sections",
    count: s.sections.length,
    titles: s.sections,
  });
}

// Batch step — runs once per section; s.__batchItem holds the current title
async function analyseSection(s: DocState): Promise<void> {
  const title = s.__batchItem!;
  const idx = s.sections.indexOf(title);

  emit<StreamChunk>(s, { type: "section:begin", index: idx, title });

  const body = await generate(
    `Write two sentences about "${title}" in the context of "${s.topic}".`,
  );
  s.analysed.push({ title, body });

  emit<StreamChunk>(s, {
    type: "section:done",
    index: idx,
    title,
    wordCount: body.split(/\s+/).length,
  });
}

// Loop body — step 1: tighten the draft and re-score
async function refineAndScore(s: DocState): Promise<void> {
  s.refinementRound++;

  const improved = await generate(
    `Improve this draft for clarity and depth (one paragraph):\n${s.analysed.map((a) => a.body).join(" ")}`,
  );

  // Update the last analysis body to the improved version
  if (s.analysed.length > 0) {
    s.analysed[s.analysed.length - 1]!.body = improved;
  }

  // Simulate a quality scorer: score improves ~0.1–0.15 per round
  s.score = Math.min(1, s.score + 0.12 + Math.random() * 0.06);

  emit<StreamChunk>(s, {
    type: "refine",
    round: s.refinementRound,
    score: parseFloat(s.score.toFixed(2)),
  });
}

async function summarise(s: DocState): Promise<void> {
  s.summary = await generate(
    `Write a one-paragraph executive summary of "${s.topic}" covering:\n${s.analysed.map((a) => `- ${a.title}`).join("\n")}`,
  );
  emit<StreamChunk>(s, { type: "summary", text: s.summary });
}

function finalise(s: DocState): void {
  const totalMs = s.__timings
    ? Object.values(s.__timings).reduce((a, b) => a + b, 0)
    : 0;
  emit<StreamChunk>(s, {
    type: "done",
    totalMs,
    score: parseFloat(s.score.toFixed(2)),
  });
}

// ── Flow factory ──────────────────────────────────────────────────────────────
//
// A new FlowBuilder instance is created per request so each client gets an
// independent flow (and an independent withStream subscriber pointing at that
// client's ReadableStream controller).

function buildFlow(subscriber: (chunk: StreamChunk) => void) {
  return (
    new FlowBuilder<DocState>()
      .withTiming()
      .withStream<StreamChunk>(subscriber)
      .startWith(validateAndStart)
      .then(splitIntoSections)
      // Analyse every section sequentially as a batch
      .batch(
        (s) => s.sections,
        (b) => b.then(analyseSection),
      )
      // Iteratively refine until quality score reaches 0.75 (max 3 rounds)
      .loop(
        (s) => s.score < 0.75 && s.refinementRound < 3,
        (b) => b.then(refineAndScore),
      )
      .then(summarise)
      .then(finalise)
  );
}

// ── ReadableStream factories ───────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Creates a ReadableStream that runs a Flowneer flow and pushes each
 * StreamChunk as a newline-terminated JSON string.
 *
 * Pattern: start() is async; it drives the entire flow run before the
 * first pull(), keeping backpressure simple and the code easy to follow.
 */
function makeNDJsonStream(topic: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const shared: DocState = {
        topic,
        sections: [],
        analysed: [],
        score: 0.3, // initial quality score
        refinementRound: 0,
        summary: "",
      };

      const flow = buildFlow((chunk) => {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      });

      try {
        await flow.run(shared);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "error", message: msg }) + "\n",
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Creates a ReadableStream that runs a Flowneer flow and formats each
 * StreamChunk as an SSE event (`data: …\n\n`).
 *
 * The `event:` field mirrors the chunk's `type` so EventSource listeners can
 * use `source.addEventListener("section:done", handler)` for selective handling.
 */
function makeSSEStream(topic: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const shared: DocState = {
        topic,
        sections: [],
        analysed: [],
        score: 0.3,
        refinementRound: 0,
        summary: "",
      };

      /** Format a single SSE frame. */
      function sseFrame(chunk: StreamChunk): string {
        return `event: ${chunk.type}\n` + `data: ${JSON.stringify(chunk)}\n\n`;
      }

      const flow = buildFlow((chunk) => {
        controller.enqueue(encoder.encode(sseFrame(chunk)));
      });

      try {
        await flow.run(shared);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`,
          ),
        );
      } finally {
        // SSE "close" convention — send a terminal event then close the stream
        controller.enqueue(encoder.encode("event: close\ndata: {}\n\n"));
        controller.close();
      }
    },
  });
}

// ── Bun HTTP server ───────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  idleTimeout: 60,
  port: PORT,

  fetch(req) {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") ?? "";

    // ── GET /stream — newline-delimited JSON ──────────────────────────────
    if (url.pathname === "/stream") {
      return new Response(makeNDJsonStream(topic), {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
        },
      });
    }

    // ── GET /events — Server-Sent Events ─────────────────────────────────
    if (url.pathname === "/events") {
      return new Response(makeSSEStream(topic), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── GET / — usage instructions ────────────────────────────────────────
    if (url.pathname === "/") {
      const body = [
        "Flowneer Streaming Server",
        "",
        "Endpoints:",
        "  GET /stream?topic=<text>  — newline-delimited JSON stream",
        "  GET /events?topic=<text>  — Server-Sent Events stream",
        "",
        "Examples:",
        `  curl -N 'http://localhost:${PORT}/stream?topic=climate+change'`,
        `  curl -N 'http://localhost:${PORT}/events?topic=quantum+computing'`,
      ].join("\n");
      return new Response(body, { headers: { "Content-Type": "text/plain" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `\nFlowneer streaming server listening on http://localhost:${server.port}`,
);
console.log(`\nTry it:`);
console.log(
  `  curl -N 'http://localhost:${server.port}/stream?topic=renewable+energy'`,
);
console.log(
  `  curl -N 'http://localhost:${server.port}/events?topic=quantum+computing'\n`,
);
