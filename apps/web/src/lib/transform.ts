import type { Diagnostic, GeneratedFile, GeneratorOptions } from "@devbridge/core";
import { TransformationError } from "@devbridge/core";
import {
  listSources,
  listTargets,
  targetsFor,
  transform,
  validate,
} from "@devbridge/engine";

export type TransformStatus = "empty" | "ok" | "invalid";

export interface TransformOutcome {
  readonly status: TransformStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly GeneratedFile[];
  /** Single-document rendering, shown when the target emits one file. */
  readonly preview: string;
  /** Names of every type discovered, root first. */
  readonly types: readonly string[];
  /**
   * What those names are, which follows the IR the transformation used and
   * not the source: an OpenAPI document produces endpoints for Postman and
   * types for the language targets.
   */
  readonly noun: string;
}

/** What a count of names refers to, per IR family. */
const NOUNS: Readonly<Record<string, string>> = {
  "type-graph": "type",
  relational: "table",
  api: "endpoint",
};

const EMPTY: TransformOutcome = {
  status: "empty",
  diagnostics: [],
  files: [],
  preview: "",
  types: [],
  noun: "type",
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
      // Type names for JSON, table names for SQL, endpoints for Postman.
      types: result.names,
      noun: NOUNS[result.irKind] ?? "type",
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
        noun: "type",
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
      noun: "type",
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

export interface SourceInfo extends TargetInfo {
  /** Extensions the file picker should accept, with the leading dot. */
  readonly accept: string;
}

export function availableSources(): readonly SourceInfo[] {
  return listSources().map((source) => ({
    id: source.id,
    label: source.label,
    accept: source.extensions.map((extension) => `.${extension}`).join(","),
  }));
}

/**
 * Targets that can read what `source` produces.
 *
 * A JSON document and a SQL schema are not interchangeable: the first
 * describes the shape of a value, the second describes tables and their
 * relationships. The picker only ever offers compatible pairs, so the user
 * cannot construct the error in the first place.
 */
export function targetsForSource(source: string): readonly TargetInfo[] {
  return targetsFor(source);
}
