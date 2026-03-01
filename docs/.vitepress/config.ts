import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";
// https://vitepress.dev/reference/site-config
export default defineConfig({
  vite: {
    plugins: [llmstxt()],
  },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  title: "Flowneer",
  description: "A tiny, zero-dependency fluent flow builder for TypeScript.",
  base: "/flowneer/",
  themeConfig: {
    // logo: "/flowneer_logo.png",
    nav: [
      { text: "Home", link: "/" },
      { text: "Core", link: "/core/getting-started" },
      { text: "Plugins", link: "/plugins/overview" },
      { text: "Recipes", link: "/recipes/" },
    ],

    sidebar: [
      {
        text: "Recipes",
        items: [
          { text: "Overview", link: "/recipes/" },
          { text: "Tool-calling Agent", link: "/recipes/tool-calling-agent" },
          { text: "Blog Post Generator", link: "/recipes/blog-post-generator" },
          {
            text: "Resilient API Pipeline",
            link: "/recipes/resilient-api-pipeline",
          },
          {
            text: "Streaming Chat Server",
            link: "/recipes/streaming-chat-server",
          },
          {
            text: "Batch Document Processing",
            link: "/recipes/batch-document-processing",
          },
          { text: "Human-in-the-loop", link: "/recipes/human-in-the-loop" },
          { text: "Edge Runtime", link: "/recipes/edge-runtime" },
        ],
      },
      {
        text: "Core",
        items: [
          { text: "Getting Started", link: "/core/getting-started" },
          { text: "FlowBuilder API", link: "/core/flow-builder" },
          { text: "Step Types", link: "/core/step-types" },
          { text: "Anchors & Routing", link: "/core/anchors-routing" },
          { text: "Streaming", link: "/core/streaming" },
          { text: "Writing Plugins", link: "/core/plugins" },
          { text: "Errors", link: "/core/errors" },
        ],
      },
      {
        text: "Plugins — LLM",
        items: [
          { text: "withCostTracker", link: "/plugins/llm/cost-tracker" },
          { text: "withRateLimit", link: "/plugins/llm/rate-limit" },
          {
            text: "withStructuredOutput",
            link: "/plugins/llm/structured-output",
          },
          { text: "withTokenBudget", link: "/plugins/llm/token-budget" },
        ],
      },
      {
        text: "Plugins — Memory",
        items: [
          { text: "Overview", link: "/plugins/memory/overview" },
          { text: "BufferWindowMemory", link: "/plugins/memory/buffer-window" },
          { text: "KVMemory", link: "/plugins/memory/kv-memory" },
          { text: "SummaryMemory", link: "/plugins/memory/summary-memory" },
          { text: "withMemory", link: "/plugins/memory/with-memory" },
        ],
      },
      {
        text: "Plugins — Observability",
        items: [
          { text: "withCallbacks", link: "/plugins/observability/callbacks" },
          { text: "withHistory", link: "/plugins/observability/history" },
          { text: "withInterrupts", link: "/plugins/observability/interrupts" },
          { text: "withTiming", link: "/plugins/observability/timing" },
          { text: "withVerbose", link: "/plugins/observability/verbose" },
        ],
      },
      {
        text: "Plugins — Persistence",
        items: [
          { text: "withCheckpoint", link: "/plugins/persistence/checkpoint" },
          { text: "withAuditLog", link: "/plugins/persistence/audit-log" },
          { text: "withReplay", link: "/plugins/persistence/replay" },
          {
            text: "withVersionedCheckpoint",
            link: "/plugins/persistence/versioned-checkpoint",
          },
        ],
      },
      {
        text: "Plugins — Resilience",
        items: [
          {
            text: "withCircuitBreaker",
            link: "/plugins/resilience/circuit-breaker",
          },
          { text: "withTimeout", link: "/plugins/resilience/timeout" },
          { text: "withFallback", link: "/plugins/resilience/fallback" },
          { text: "withTryCatch", link: "/plugins/resilience/try-catch" },
          { text: "withCycles", link: "/plugins/resilience/cycles" },
        ],
      },
      {
        text: "Plugins — Dev / Testing",
        items: [
          { text: "withDryRun", link: "/plugins/dev/dry-run" },
          { text: "withMocks", link: "/plugins/dev/mocks" },
          { text: "withStepLimit", link: "/plugins/dev/step-limit" },
          { text: "parallelAtomic", link: "/plugins/dev/atomic-updates" },
        ],
      },
      {
        text: "Plugins — Agent",
        items: [
          { text: "createAgent & tool()", link: "/plugins/agent/create-agent" },
          { text: "withReActLoop", link: "/plugins/agent/react-loop" },
          { text: "humanNode", link: "/plugins/agent/human-node" },
          { text: "Multi-agent Patterns", link: "/plugins/agent/patterns" },
        ],
      },
      {
        text: "Plugins — Tools",
        items: [
          { text: "withTools & ToolRegistry", link: "/plugins/tools/overview" },
        ],
      },
      {
        text: "Plugins — Messaging",
        items: [
          { text: "withChannels", link: "/plugins/messaging/channels" },
          { text: "withStream & emit()", link: "/plugins/messaging/stream" },
        ],
      },
      {
        text: "Plugins — Output Parsers",
        items: [
          { text: "parseJsonOutput", link: "/plugins/output/parse-json" },
          { text: "parseListOutput", link: "/plugins/output/parse-list" },
          { text: "parseRegexOutput", link: "/plugins/output/parse-regex" },
          { text: "parseMarkdownTable", link: "/plugins/output/parse-table" },
        ],
      },
      {
        text: "Plugins — Telemetry",
        items: [
          { text: "TelemetryDaemon", link: "/plugins/telemetry/overview" },
        ],
      },
      {
        text: "Plugins — Graph",
        items: [
          { text: "Graph Composition", link: "/plugins/graph/overview" },
          { text: "Graph & Flow Export", link: "/plugins/graph/export" },
        ],
      },
      {
        text: "Plugins — Eval",
        items: [{ text: "Evaluation Suite", link: "/plugins/eval/overview" }],
      },
      {
        text: "Reference",
        items: [{ text: "Plugins Overview", link: "/plugins/overview" }],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/Fanna1119/flowneer" },
    ],

    search: {
      provider: "local",
    },
  },
});
