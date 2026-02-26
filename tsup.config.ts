import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "index.ts",
    "src/index.ts",
    "plugins/index.ts",
    "plugins/observability/index.ts",
    "plugins/resilience/index.ts",
    "plugins/persistence/index.ts",
    "plugins/llm/index.ts",
    "plugins/dev/index.ts",
    "plugins/messaging/index.ts",
    "plugins/tools/index.ts",
    "plugins/agent/index.ts",
    "plugins/memory/index.ts",
    "plugins/output/index.ts",
    "plugins/telemetry/index.ts",
    "plugins/eval/index.ts",
    "plugins/graph/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  splitting: false,
  sourcemap: false,
});
