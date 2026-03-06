// ---------------------------------------------------------------------------
// Flowneer — JsonFlowBuilder example
// ---------------------------------------------------------------------------
// Demonstrates building, validating, and running flows from plain JSON config.
// Useful for config-driven pipelines, UI-generated flows, or deployments where
// flow topology is stored externally (database, feature flags, CMS).
//
// Five scenarios are shown:
//
//   1. Linear fn chain  — simplest possible config
//   2. Branch step      — router + per-arm handlers
//   3. Anchor + goto    — retry loop without a .loop() call
//   4. Nested batch     — per-item processor defined in configuration
//   5. Custom step type — registerStepBuilder extension point
//   +  Validation errors — inspect errors before building
//
// No API key required — no LLM calls are made.
// Run with: bun run examples/jsonConfigExample.ts
// ---------------------------------------------------------------------------

import {
  JsonFlowBuilder,
  validate,
  ConfigValidationError,
} from "../plugins/config";
import type { FlowConfig, FnRegistry } from "../plugins/config";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Linear fn chain
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 1 — linear fn chain");

{
  interface State {
    value: number;
    result?: number;
  }

  const registry: FnRegistry = {
    double: async (s: any) => {
      s.value *= 2;
    },
    addTen: async (s: any) => {
      s.value += 10;
    },
    print: async (s: any) => {
      s.result = s.value;
      console.log(`  result = ${s.value}`);
    },
  };

  const config: FlowConfig = {
    steps: [
      { type: "fn", fn: "double" },
      { type: "fn", fn: "addTen" },
      { type: "fn", fn: "print" },
    ],
  };

  // Validate before building (returns all errors, never throws)
  const check = JsonFlowBuilder.validate(config, registry);
  console.log(`  validation passed: ${check.valid}`);

  const flow = JsonFlowBuilder.build(config, registry);
  await flow.run({ value: 5 } as State);
  // 5 * 2 = 10, + 10 = 20
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Branch step
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 2 — branch step");

{
  interface State {
    tier: string;
    discount?: number;
    message?: string;
  }

  const registry: FnRegistry = {
    routeTier: async (s: any) => s.tier,
    goldPath: async (s: any) => {
      s.discount = 20;
      s.message = "Gold: 20% off";
    },
    silverPath: async (s: any) => {
      s.discount = 10;
      s.message = "Silver: 10% off";
    },
    defaultPath: async (s: any) => {
      s.discount = 0;
      s.message = "Standard: no discount";
    },
    printOffer: async (s: any) => {
      console.log(`  ${s.message}`);
    },
  };

  const config: FlowConfig = {
    steps: [
      {
        type: "branch",
        router: "routeTier",
        branches: {
          gold: "goldPath",
          silver: "silverPath",
          default: "defaultPath",
        },
        label: "tier-router",
      },
      { type: "fn", fn: "printOffer" },
    ],
  };

  const flow = JsonFlowBuilder.build(config, registry);

  for (const tier of ["gold", "silver", "bronze"]) {
    const shared: State = { tier };
    await flow.run(shared);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Anchor + goto retry loop
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 3 — anchor + goto retry loop");

{
  interface State {
    attempts: number;
    success?: boolean;
  }

  const registry: FnRegistry = {
    init: async (s: any) => {
      s.attempts = 0;
    },
    tryWork: async (s: any) => {
      s.attempts++;
      console.log(`  attempt ${s.attempts}`);
      if (s.attempts >= 3) s.success = true;
      // Return an anchor name to retry, or undefined to continue
      return s.success ? undefined : "#retry";
    },
    finish: async (s: any) => {
      console.log(`  done after ${s.attempts} attempt(s)`);
    },
  };

  const config: FlowConfig = {
    steps: [
      { type: "fn", fn: "init" },
      { type: "anchor", name: "retry", maxVisits: 5 },
      { type: "fn", fn: "tryWork" },
      { type: "fn", fn: "finish" },
    ],
  };

  const flow = JsonFlowBuilder.build(config, registry);
  await flow.run({} as State);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Batch — process each item in a list
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 4 — batch processor");

{
  interface State {
    invoices: string[];
    processed: string[];
  }

  const registry: FnRegistry = {
    getInvoices: async (s: any) => s.invoices,
    processOne: async (s: any) => {
      // Inside a batch, the current item is at shared.__batchItem
      const invoice = (s as any).__batchItem as string;
      s.processed = s.processed ?? [];
      s.processed.push(`PROCESSED:${invoice.toUpperCase()}`);
      console.log(`  processed ${invoice}`);
    },
    summarize: async (s: any) => {
      console.log(`  total processed: ${s.processed.length}`);
    },
  };

  const config: FlowConfig = {
    steps: [
      {
        type: "batch",
        items: "getInvoices",
        processor: [{ type: "fn", fn: "processOne" }],
        label: "invoice-batch",
      },
      { type: "fn", fn: "summarize" },
    ],
  };

  const flow = JsonFlowBuilder.build(config, registry);
  const shared: State = {
    invoices: ["inv-001", "inv-002", "inv-003"],
    processed: [],
  };
  await flow.run(shared);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Parallel steps
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 5 — parallel steps");

{
  interface State {
    scores: Record<string, number>;
  }

  const registry: FnRegistry = {
    scoreRelevance: async (s: any) => {
      s.scores = s.scores ?? {};
      s.scores.relevance = 0.9;
    },
    scoreCoherence: async (s: any) => {
      s.scores = s.scores ?? {};
      s.scores.coherence = 0.85;
    },
    scoreGrounding: async (s: any) => {
      s.scores = s.scores ?? {};
      s.scores.grounding = 0.78;
    },
    printScores: async (s: any) =>
      console.log("  scores:", JSON.stringify(s.scores)),
  };

  const config: FlowConfig = {
    steps: [
      {
        type: "parallel",
        fns: ["scoreRelevance", "scoreCoherence", "scoreGrounding"],
        label: "eval-parallel",
      },
      { type: "fn", fn: "printScores" },
    ],
  };

  const flow = JsonFlowBuilder.build(config, registry);
  await flow.run({ scores: {} } as State);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Custom step type via registerStepBuilder
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 6 — custom step type: 'log'");

{
  // Register a custom "log" step type that prints a fixed message
  JsonFlowBuilder.registerStepBuilder("log", (step: any, flow, _registry) => {
    flow.then(
      async () => {
        console.log(`  [log] ${step.message ?? "(no message)"}`);
      },
      { label: step.label },
    );
  });

  const config = {
    steps: [
      { type: "log", message: "pipeline started" },
      { type: "log", message: "pipeline finished" },
    ],
  } as FlowConfig;

  const flow = JsonFlowBuilder.build(config, {});
  await flow.run({});
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation error example — inspect all errors before building
// ─────────────────────────────────────────────────────────────────────────────

separator("Validation errors — inspect without building");

{
  const badConfig = {
    steps: [
      { type: "fn", fn: "missingA" }, // not in registry
      { type: "fn", fn: "missingB" }, // not in registry
      { type: "anchor", name: "dup" },
      { type: "anchor", name: "dup" }, // duplicate anchor
      { type: "branch", router: "route", branches: { ok: "missingC" } }, // router + branch fn missing
    ],
  } as FlowConfig;

  const result = JsonFlowBuilder.validate(badConfig, {});
  console.log(`  valid: ${result.valid}`);
  console.log(`  errors (${result.errors.length}):`);
  for (const e of result.errors) {
    console.log(`    ${e.path}: ${e.message}`);
  }

  // Build throws ConfigValidationError with the same error list
  try {
    JsonFlowBuilder.build(badConfig, {});
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.log(
        `\n  Caught ConfigValidationError with ${err.errors.length} error(s).`,
      );
    }
  }
}

console.log();
