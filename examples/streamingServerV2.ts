// ---------------------------------------------------------------------------
// Flowneer — Streaming Server V2 (native stream() API + generator steps)
// ---------------------------------------------------------------------------
// Same document-processing pipeline as streamingServer.ts but uses:
//   1. FlowBuilder.stream() async generator instead of the withStream plugin
//   2. async function* step declarations — each `yield` becomes a chunk event
//      received by the flow.stream() consumer, no emit() helper needed
//
// StreamEvent types yielded by flow.stream():
//
//   step:before  — fires before every step (carries StepMeta)
//   step:after   — fires after every step (carries StepMeta + shared state)
//   chunk        — carries values yielded by generator steps
//   error        — carries a thrown error
//   done         — always the last event
//
// Two endpoints are served on port 3001 (to avoid clashing with V1):
//
//   GET /stream   — newline-delimited JSON (chunked transfer)
//   GET /events   — Server-Sent Events (EventSource-compatible)
//
// Run:   bun run examples/streamingServerV2.ts
// Test:  curl -N 'http://localhost:3001/stream?topic=climate+change'
//        curl -N 'http://localhost:3001/events?topic=quantum+computing'
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import type { StreamEvent } from "../Flowneer";
import { withTiming } from "../plugins/observability";

// ── Plugin registration ───────────────────────────────────────────────────────
// Only withTiming is registered. withStream is not used at all.

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
}

// ── Simulated work helpers ────────────────────────────────────────────────────

function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generate(prompt: string): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    const { callLlm } = await import("../utils/callLlm");
    return callLlm(prompt);
  }
  await Bun.sleep(jitter(120, 350));
  const seed = prompt.slice(0, 40).replace(/\W/g, " ").trim();
  return `[simulated output for: "${seed}…"]`;
}

// ── Step functions ────────────────────────────────────────────────────────────

async function* validateAndStart(s: DocState) {
  s.topic = s.topic.trim() || "the future of renewable energy";
  yield { type: "start", topic: s.topic } as StreamChunk;
  await Bun.sleep(50);
}

async function* splitIntoSections(s: DocState) {
  const raw = await generate(
    `List 4 section titles for a short document about: "${s.topic}". One per line, no numbering.`,
  );

  s.sections = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (s.sections.length < 4) {
    s.sections = [
      `Introduction to ${s.topic}`,
      `Key developments`,
      `Challenges and opportunities`,
      `Future outlook`,
    ];
  }

  yield {
    type: "sections",
    count: s.sections.length,
    titles: s.sections,
  } as StreamChunk;
}

async function* analyseSection(s: DocState) {
  const title = s.__batchItem!;
  const idx = s.sections.indexOf(title);

  yield { type: "section:begin", index: idx, title } as StreamChunk;

  const body = await generate(
    `Write two sentences about "${title}" in the context of "${s.topic}".`,
  );
  s.analysed.push({ title, body });

  yield {
    type: "section:done",
    index: idx,
    title,
    wordCount: body.split(/\s+/).length,
  } as StreamChunk;
}

async function* refineAndScore(s: DocState) {
  s.refinementRound++;

  const improved = await generate(
    `Improve this draft for clarity and depth (one paragraph):\n${s.analysed.map((a) => a.body).join(" ")}`,
  );

  if (s.analysed.length > 0) {
    s.analysed[s.analysed.length - 1]!.body = improved;
  }

  s.score = Math.min(1, s.score + 0.12 + Math.random() * 0.06);

  yield {
    type: "refine",
    round: s.refinementRound,
    score: parseFloat(s.score.toFixed(2)),
  } as StreamChunk;
}

async function* summarise(s: DocState) {
  s.summary = await generate(
    `Write a one-paragraph executive summary of "${s.topic}" covering:\n${s.analysed.map((a) => `- ${a.title}`).join("\n")}`,
  );
  yield { type: "summary", text: s.summary } as StreamChunk;
}

async function* finalise(s: DocState) {
  const totalMs = s.__timings
    ? Object.values(s.__timings).reduce((a, b) => a + b, 0)
    : 0;
  yield {
    type: "done",
    totalMs,
    score: parseFloat(s.score.toFixed(2)),
  } as StreamChunk;
}

// ── Flow factory ──────────────────────────────────────────────────────────────
//
// No subscriber callback — callers iterate flow.stream() directly.

function buildFlow() {
  return new FlowBuilder<DocState>()
    .withTiming()
    .startWith(validateAndStart)
    .then(splitIntoSections)
    .batch(
      (s) => s.sections,
      (b) => b.then(analyseSection),
    )
    .loop(
      (s) => s.score < 0.75 && s.refinementRound < 3,
      (b) => b.then(refineAndScore),
    )
    .then(summarise)
    .then(finalise);
}

// ── ReadableStream factories ──────────────────────────────────────────────────

const encoder = new TextEncoder();

function initialState(topic: string): DocState {
  return {
    topic,
    sections: [],
    analysed: [],
    score: 0.3,
    refinementRound: 0,
    summary: "",
  };
}

/**
 * Newline-delimited JSON stream.
 *
 * Each event is serialised as one JSON line:
 *   - StreamChunk payloads come through as `{ "type": "chunk", "data": { ... } }`
 *     so the raw application chunk is unwrapped to keep the wire format clean.
 *   - step:before / step:after are also forwarded so clients can show progress.
 *   - error and done are forwarded verbatim.
 */
function makeNDJsonStream(topic: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        for await (const event of buildFlow().stream(initialState(topic))) {
          switch (event.type) {
            case "chunk":
              // Unwrap the application-level chunk — this is a StreamChunk
              enqueue(event.data);
              break;
            case "step:before":
              enqueue({
                type: "step:before",
                label: event.meta.label ?? `step-${event.meta.index}`,
              });
              break;
            case "step:after":
              enqueue({
                type: "step:after",
                label: event.meta.label ?? `step-${event.meta.index}`,
              });
              break;
            case "error":
              enqueue({
                type: "error",
                message:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error),
              });
              break;
            // "done" is the terminal flow event — the stream() generator ends
            // after yielding it, so the loop exits naturally.
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Server-Sent Events stream.
 *
 * Each SSE frame uses the application chunk's `type` as the `event:` field
 * so clients can do `source.addEventListener("section:done", handler)`.
 * step:before / step:after frames use their own type names.
 */
function makeSSEStream(topic: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (eventName: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(
            `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );

      try {
        for await (const event of buildFlow().stream(initialState(topic))) {
          switch (event.type) {
            case "chunk": {
              // The data is a StreamChunk — use its type as the SSE event name
              const chunk = event.data as StreamChunk;
              enqueue(chunk.type, chunk);
              break;
            }
            case "step:before":
              enqueue("step:before", {
                label: event.meta.label ?? `step-${event.meta.index}`,
              });
              break;
            case "step:after":
              enqueue("step:after", {
                label: event.meta.label ?? `step-${event.meta.index}`,
              });
              break;
            case "error":
              enqueue("error", {
                message:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error),
              });
              break;
            case "done":
              enqueue("close", {});
              break;
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// ── Bun HTTP server ───────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

const server = Bun.serve({
  idleTimeout: 60,
  port: PORT,

  fetch(req) {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") ?? "";

    if (url.pathname === "/stream") {
      return new Response(makeNDJsonStream(topic), {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    }

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

    if (url.pathname === "/") {
      const body = [
        "Flowneer Streaming Server V2 (native stream() API + generator steps)",
        "",
        "Endpoints:",
        "  GET /stream?topic=<text>  — newline-delimited JSON stream",
        "  GET /events?topic=<text>  — Server-Sent Events stream",
        "",
        "Examples:",
        `  curl -N 'http://localhost:${PORT}/stream?topic=climate+change'`,
        `  curl -N 'http://localhost:${PORT}/events?topic=quantum+computing'`,
        "",
        "StreamEvent types forwarded to clients:",
        "  chunk        — application StreamChunk from emit() calls",
        "  step:before  — fires before each step",
        "  step:after   — fires after each step",
        "  error        — step threw an error",
        "  close        — flow completed (SSE only)",
      ].join("\n");
      return new Response(body, { headers: { "Content-Type": "text/plain" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `\nFlowneer streaming server V2 listening on http://localhost:${server.port}`,
);
console.log(`\nTry it:`);
console.log(
  `  curl -N 'http://localhost:${server.port}/stream?topic=renewable+energy'`,
);
console.log(
  `  curl -N 'http://localhost:${server.port}/events?topic=quantum+computing'\n`,
);
