import "dotenv/config";
import { FlowBuilder } from "../Flowneer";
import { OpenAI } from "openai";

const openai = new OpenAI();

// ─── State ───────────────────────────────────────────────────────────────────

interface ChatState {
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  reply: string;
}

// ─── Flow ────────────────────────────────────────────────────────────────────

const chatFlow = new FlowBuilder<ChatState>()
  .startWith(async (s) => {
    s.history.push({ role: "user", content: s.userMessage });
  })

  .then(async function* streamLlm(s) {
    // Use OpenAI streaming — yield each text delta as a chunk
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        ...s.history,
      ],
      stream: true,
    });

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        yield delta; // ← each token becomes a `chunk` event via .stream()
      }
    }
    s.reply = full;
  })

  .then((s) => {
    s.history.push({ role: "assistant", content: s.reply });
  });

// ─── Session store ──────────────────────────────────────────────────────────
// Keyed by session ID so history persists across requests from the same client.

const sessions = new Map<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
>();

function getOrCreateSession(id: string) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id)!;
}

// ─── Server ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // ── SSE endpoint ────────────────────────────────────────────────────────
    if (url.pathname === "/chat" && req.method === "POST") {
      const { message, sessionId } = (await req.json()) as {
        message: string;
        sessionId?: string;
      };
      const sid = sessionId ?? crypto.randomUUID();

      const state: ChatState = {
        userMessage: message,
        history: getOrCreateSession(sid), // ← reuse persisted history
        reply: "",
      };

      const encoder = new TextEncoder();

      const body = new ReadableStream({
        async start(controller) {
          for await (const event of chatFlow.stream(state)) {
            if (event.type === "chunk") {
              // SSE format: "data: <payload>\n\n"
              const line = `data: ${JSON.stringify(event.data)}\n\n`;
              controller.enqueue(encoder.encode(line));
            }
            if (event.type === "error") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: String(event.error) })}\n\n`,
                ),
              );
            }
            if (event.type === "done") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`,
                ),
              );
              controller.close();
            }
          }
        },
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ── Simple HTML client ────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(htmlClient, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log("Streaming chat server running at http://localhost:3000");

// ─── Minimal browser client ───────────────────────────────────────────────────

const htmlClient = `<!DOCTYPE html>
<html>
<head><title>Flowneer Chat</title></head>
<body>
  <div id="output" style="white-space:pre-wrap;font-family:monospace;max-width:700px"></div>
  <input id="msg" style="width:500px" placeholder="Ask something..." />
  <button onclick="send()">Send</button>
  <script>
    let sessionId = null;
    async function send() {
      const input = document.getElementById('msg');
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      const out = document.getElementById('output');
      out.textContent += '\\nYou: ' + msg + '\\nAssistant: ';
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, sessionId }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        for (const line of text.split('\\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.done) { sessionId = payload.sessionId; break; }
          if (payload.error) { out.textContent += '[error] ' + payload.error; break; }
          out.textContent += payload;
        }
      }
      out.textContent += '\\n';
    }
    document.getElementById('msg').addEventListener('keydown', e => e.key === 'Enter' && send());
  </script>
</body>
</html>`;
