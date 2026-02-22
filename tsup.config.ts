import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "index.ts",
    "plugins/index.ts",
    "plugins/observability/index.ts",
    "plugins/resilience/index.ts",
    "plugins/persistence/index.ts",
    "plugins/llm/index.ts",
    "plugins/dev/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  splitting: false,
  sourcemap: false,
});
