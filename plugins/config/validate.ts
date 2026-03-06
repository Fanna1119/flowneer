// ---------------------------------------------------------------------------
// validate — structural + registry validation for FlowConfig
// ---------------------------------------------------------------------------

import type {
  StepConfig,
  FlowConfig,
  FnRegistry,
  ValidationError,
  ValidationResult,
} from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function err(path: string, message: string): ValidationError {
  return { path, message };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step validator
// ─────────────────────────────────────────────────────────────────────────────

function validateStep(
  step: unknown,
  path: string,
  registry: FnRegistry,
  errors: ValidationError[],
  anchorNames: Set<string>,
  additionalTypes?: ReadonlySet<string>,
): void {
  if (!isRecord(step)) {
    errors.push(err(path, "must be an object"));
    return;
  }

  const type = step.type;
  if (typeof type !== "string") {
    errors.push(err(`${path}.type`, "must be a string"));
    return;
  }

  const checkFnRef = (key: string, ref: unknown) => {
    if (typeof ref !== "string") {
      errors.push(err(`${path}.${key}`, `must be a string (registry key)`));
    } else if (!(ref in registry)) {
      errors.push(err(`${path}.${key}`, `"${ref}" not found in registry`));
    }
  };

  const checkOptionalNumber = (key: string) => {
    const v = step[key];
    if (v !== undefined && typeof v !== "number") {
      errors.push(err(`${path}.${key}`, `must be a number`));
    }
  };

  switch (type) {
    case "fn": {
      checkFnRef("fn", step.fn);
      checkOptionalNumber("retries");
      checkOptionalNumber("delaySec");
      checkOptionalNumber("timeoutMs");
      break;
    }

    case "branch": {
      checkFnRef("router", step.router);
      checkOptionalNumber("retries");
      checkOptionalNumber("delaySec");
      checkOptionalNumber("timeoutMs");
      if (!isRecord(step.branches)) {
        errors.push(err(`${path}.branches`, "must be an object"));
      } else {
        for (const [key, ref] of Object.entries(step.branches)) {
          checkFnRef(`branches.${key}`, ref);
        }
      }
      break;
    }

    case "loop": {
      checkFnRef("condition", step.condition);
      if (!Array.isArray(step.body)) {
        errors.push(err(`${path}.body`, "must be an array"));
      } else {
        validateSteps(
          step.body as unknown[],
          `${path}.body`,
          registry,
          errors,
          anchorNames,
          additionalTypes,
        );
      }
      break;
    }

    case "batch": {
      checkFnRef("items", step.items);
      if (step.key !== undefined && typeof step.key !== "string") {
        errors.push(err(`${path}.key`, "must be a string"));
      }
      if (!Array.isArray(step.processor)) {
        errors.push(err(`${path}.processor`, "must be an array"));
      } else {
        validateSteps(
          step.processor as unknown[],
          `${path}.processor`,
          registry,
          errors,
          anchorNames,
          additionalTypes,
        );
      }
      break;
    }

    case "parallel": {
      checkOptionalNumber("retries");
      checkOptionalNumber("delaySec");
      checkOptionalNumber("timeoutMs");
      if (!Array.isArray(step.fns)) {
        errors.push(err(`${path}.fns`, "must be an array"));
      } else {
        (step.fns as unknown[]).forEach((ref, fi) =>
          checkFnRef(`fns[${fi}]`, ref),
        );
      }
      break;
    }

    case "anchor": {
      if (typeof step.name !== "string" || step.name.trim() === "") {
        errors.push(err(`${path}.name`, "must be a non-empty string"));
        break;
      }
      if (anchorNames.has(step.name as string)) {
        errors.push(
          err(`${path}.name`, `duplicate anchor name "${step.name}"`),
        );
      } else {
        anchorNames.add(step.name as string);
      }
      if (step.maxVisits !== undefined && typeof step.maxVisits !== "number") {
        errors.push(err(`${path}.maxVisits`, "must be a number"));
      }
      break;
    }

    default: {
      if (!additionalTypes?.has(type)) {
        errors.push(err(`${path}.type`, `unknown step type "${type}"`));
      }
    }
  }
}

function validateSteps(
  steps: unknown[],
  path: string,
  registry: FnRegistry,
  errors: ValidationError[],
  anchorNames: Set<string>,
  additionalTypes?: ReadonlySet<string>,
): void {
  for (let i = 0; i < steps.length; i++) {
    validateStep(
      steps[i],
      `${path}[${i}]`,
      registry,
      errors,
      anchorNames,
      additionalTypes,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a raw config object + registry without building anything.
 *
 * Checks:
 * 1. Structural shape of every step (correct type, required fields)
 * 2. All function references exist in the registry
 * 3. Duplicate anchor names
 * 4. Recursive validation of nested body / processor arrays
 *
 * Returns all errors found — does **not** short-circuit on the first error.
 *
 * Pass `additionalTypes` (e.g. from `JsonFlowBuilder.registerStepBuilder`) to
 * allow custom step types without treating them as unknown types.
 *
 * @example
 * const result = validate(config, registry);
 * if (!result.valid) {
 *   for (const e of result.errors) console.error(`${e.path}: ${e.message}`);
 * }
 */
export function validate(
  config: unknown,
  registry: FnRegistry,
  additionalTypes?: ReadonlySet<string>,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isRecord(config)) {
    return { valid: false, errors: [err("$", "config must be an object")] };
  }

  if (!Array.isArray(config.steps)) {
    errors.push(err("$.steps", "must be an array"));
    return { valid: errors.length === 0, errors };
  }

  const anchorNames = new Set<string>();
  validateSteps(
    config.steps as unknown[],
    "$.steps",
    registry,
    errors,
    anchorNames,
    additionalTypes,
  );

  return { valid: errors.length === 0, errors };
}
