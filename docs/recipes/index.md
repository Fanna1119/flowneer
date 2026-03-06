# Recipes

End-to-end examples for common Flowneer patterns. Each recipe is self-contained and runnable — copy it, swap in your API keys, and go.

## Available recipes

| Recipe                                                      | What it shows                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Tool-calling Agent](./tool-calling-agent.md)               | `createAgent` + `tool()`, OpenAI function calling, multi-turn loop              |
| [Blog Post Generator](./blog-post-generator.md)             | Sequential LLM pipeline, structured output, cost tracking                       |
| [Resilient API Pipeline](./resilient-api-pipeline.md)       | Retry, timeout, circuit breaker, fallback                                       |
| [Streaming Chat Server](./streaming-chat-server.md)         | `.stream()`, server-sent events, Bun HTTP                                       |
| [Batch Document Processing](./batch-document-processing.md) | `.batch()`, `.parallel()`, structured output, shared reducer                    |
| [Human-in-the-loop](./human-in-the-loop.md)                 | `humanNode`, interrupt + resume, approval gates                                 |
| [Edge Runtime](./edge-runtime.md)                           | CF Workers, Vercel Edge, Deno Deploy — zero-config, streaming, telemetry caveat |
