# Streaming Chat Server

Build an HTTP server that streams LLM token chunks to the browser using [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events). Each request runs a Flowneer flow via `.stream()`, forwarding every `chunk` event to the client in real time.

**Plugins used:** none — generator steps + `.stream()` (core API)

---

## The code

```typescript
import "dotenv/config";
import { FlowBuilder } from "flowneer";
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

// ─── Server ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // ── SSE endpoint ────────────────────────────────────────────────────────
    if (url.pathname === "/chat" && req.method === "POST") {
      const { message } = (await req.json()) as { message: string };

      const state: ChatState = {
        userMessage: message,
        history: [],
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
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
    async function send() {
      const msg = document.getElementById('msg').value;
      const out = document.getElementById('output');
      out.textContent += '\\nYou: ' + msg + '\\nAssistant: ';
      const es = new EventSource('/chat');
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        for (const line of text.split('\\n')) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (payload === '[DONE]') break;
            out.textContent += JSON.parse(payload);
          }
        }
      }
      out.textContent += '\\n';
    }
  </script>
</body>
</html>`;
```

---

## How `.stream()` works with async generators

Flowneer's `.stream()` listens for two signal types:

| What you do in a step                        | What the consumer sees                 |
| -------------------------------------------- | -------------------------------------- |
| `emit(s, value)`                             | `{ type: "chunk", data: value }`       |
| `yield value` from an `async function*` step | `{ type: "chunk", data: value }`       |
| Step starts                                  | `{ type: "step:before", meta }`        |
| Step ends                                    | `{ type: "step:after", meta, shared }` |
| Any thrown error                             | `{ type: "error", error }`             |
| Flow completes                               | `{ type: "done" }`                     |

The `streamLlm` step above is an `async function*` — every `yield` is automatically forwarded as a chunk. This avoids manual `emit()` calls inside generator steps.

## Variation — Express / Node.js

Replace `Bun.serve` with Express:

```typescript
import express from "express";
const app = express();
app.use(express.json());

app.post("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const state: ChatState = {
    userMessage: req.body.message,
    history: [],
    reply: "",
  };

  for await (const event of chatFlow.stream(state)) {
    if (event.type === "chunk")
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    if (event.type === "done") {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

app.listen(3000);
```

---

## See also

- [withStream & emit()](../plugins/messaging/stream.md)
- [Streaming — core API](../core/streaming.md)
