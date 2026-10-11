import type { Diagnostic, GeneratedFile, GeneratorOptions } from "@devbridge/core";
import { TransformationError } from "@devbridge/core";
import { listTargets, transform, validate } from "@devbridge/engine";

export type TransformStatus = "empty" | "ok" | "invalid";

export interface TransformOutcome {
  readonly status: TransformStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly GeneratedFile[];
  /** Single-document rendering, shown when the target emits one file. */
  readonly preview: string;
  /** Names of every type discovered, root first. */
  readonly types: readonly string[];
}

const EMPTY: TransformOutcome = {
  status: "empty",
  diagnostics: [],
  files: [],
  preview: "",
  types: [],
};

/**
 * Runs one transformation and reports failure as data rather than throwing.
 *
 * The UI re-runs this on every keystroke, so a half-typed document is the
 * normal case, not an exceptional one: an invalid artifact produces
 * diagnostics to render, never an exception to catch at the call site.
 */
export function runTransform(
  input: string,
  target: string,
  options: GeneratorOptions = {},
  rootName?: string,
  source = "json",
): TransformOutcome {
  if (input.trim().length === 0) {
    return EMPTY;
  }

  try {
    const result = transform({
      input,
      source,
      target,
      ...(rootName === undefined || rootName.trim().length === 0
        ? {}
        : { parseOptions: { rootName: rootName.trim() } }),
      generatorOptions: options,
    });

    return {
      status: "ok",
      diagnostics: result.diagnostics,
      files: result.files,
      preview: result.preview,
      types: result.types,
    };
  } catch (error) {
    if (error instanceof TransformationError) {
      return {
        status: "invalid",
        // A TransformationError may carry located diagnostics; if it does not,
        // surface its message so the user is never shown an empty error state.
        diagnostics:
          error.diagnostics.length > 0
            ? error.diagnostics
            : [
                {
                  severity: "error",
                  code: "transform/failed",
                  message: error.message,
                },
              ],
        files: [],
        preview: "",
        types: [],
      };
    }

    return {
      status: "invalid",
      diagnostics: [
        {
          severity: "error",
          code: "transform/unexpected",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      files: [],
      preview: "",
      types: [],
    };
  }
}

/** Validates without generating, for the "is this artifact usable" indicator. */
export function validateInput(
  input: string,
  source = "json",
): readonly Diagnostic[] {
  if (input.trim().length === 0) {
    return [];
  }

  try {
    return validate(input, source);
  } catch (error) {
    return [
      {
        severity: "error",
        code: "validate/unexpected",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

export interface TargetInfo {
  readonly id: string;
  readonly label: string;
}

export function availableTargets(): readonly TargetInfo[] {
  return listTargets();
}
