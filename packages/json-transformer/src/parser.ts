import type {
  Diagnostic,
  ParseOptions,
  ParseResult,
  SourceParser,
} from "@devbridge/core";
import { TransformationError, offsetToPosition } from "@devbridge/core";

import { buildIr } from "./builder.js";
import type { ObjectShape, Shape } from "./shape.js";
import { inferShape, mergeShapes } from "./shape.js";

export interface JsonParseOptions extends ParseOptions {
  /**
   * How to treat a JSON document whose root is an array.
   * - `item` (default): the root type describes one element of the array.
   * - `error`: reject the document.
   */
  readonly arrayRoot?: "item" | "error";
}

/**
 * Removes a leading UTF-8 byte order mark.
 *
 * `JSON.parse` rejects a BOM, and Windows editors (and PowerShell's
 * `Set-Content -Encoding utf8`) write one by default, so a perfectly good
 * document would otherwise be reported as a syntax error. Stripping happens
 * before anything else so diagnostic offsets refer to the text we parsed.
 */
function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/** Extracts position information out of a native `JSON.parse` error message. */
function describeSyntaxError(input: string, error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);

  const lineColumn = /line (\d+) column (\d+)/i.exec(message);
  const positionMatch = /position (\d+)/i.exec(message);

  let line: number | undefined;
  let column: number | undefined;
  let offset: number | undefined;

  if (positionMatch?.[1] !== undefined) {
    offset = Number(positionMatch[1]);
  }

  if (lineColumn?.[1] !== undefined && lineColumn[2] !== undefined) {
    line = Number(lineColumn[1]);
    column = Number(lineColumn[2]);
  } else if (offset !== undefined) {
    const position = offsetToPosition(input, offset);

    line = position.line;
    column = position.column;
  }

  return {
    severity: "error",
    code: "json/invalid-syntax",
    message: message.replace(/^JSON\.parse:\s*/, ""),
    ...(offset === undefined ? {} : { offset }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    hint: "Check for a trailing comma, an unquoted key or a missing bracket.",
  };
}

const EMPTY_INPUT: Diagnostic = {
  severity: "error",
  code: "json/empty-input",
  message: "The input is empty.",
  line: 1,
  column: 1,
  hint: "Paste or load a JSON document first.",
};

function rootKindDiagnostic(actual: string): Diagnostic {
  return {
    severity: "error",
    code: "json/unsupported-root",
    message: "JSON root must be an object",
    line: 1,
    column: 1,
    hint: `Found ${actual}. Wrap the value in an object, for example {"value": ...}.`,
  };
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "an array";
  }

  return `a ${typeof value}`;
}

/**
 * Reduces a root array to the single object shape that describes its elements.
 * Returns undefined when the array holds no objects.
 */
function rootShapeFromArray(values: readonly unknown[]): ObjectShape | undefined {
  let merged: Shape | undefined;

  for (const value of values) {
    const shape = inferShape(value);

    merged = merged === undefined ? shape : mergeShapes(merged, shape);
  }

  return merged !== undefined && merged.kind === "object" ? merged : undefined;
}

/** Reports every problem that would stop `parseJson` from producing IR. */
export function validateJson(input: string): readonly Diagnostic[] {
  const text = stripBom(input);

  if (text.trim().length === 0) {
    return [EMPTY_INPUT];
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return [describeSyntaxError(text, error)];
  }

  if (Array.isArray(value)) {
    if (rootShapeFromArray(value) === undefined) {
      return [
        {
          severity: "error",
          code: "json/unsupported-root",
          message:
            "A root array must contain at least one object to describe.",
          line: 1,
          column: 1,
          hint: 'Wrap the value in an object, for example {"items": [...]}.',
        },
      ];
    }

    return [];
  }

  if (value === null || typeof value !== "object") {
    return [rootKindDiagnostic(describeValue(value))];
  }

  return [];
}

/**
 * Parses a JSON document into the shared IR.
 *
 * @throws {TransformationError} when the document cannot be represented.
 */
export function parseJson(
  input: string,
  options: JsonParseOptions | string = {},
): ParseResult {
  // The original signature took a positional root name; keep it working.
  const resolved: JsonParseOptions =
    typeof options === "string" ? { rootName: options } : options;

  const rootName = resolved.rootName ?? "Root";
  const arrayRoot = resolved.arrayRoot ?? "item";

  const text = stripBom(input);

  if (text.trim().length === 0) {
    throw new TransformationError(EMPTY_INPUT.message, [EMPTY_INPUT]);
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    const diagnostic = describeSyntaxError(text, error);

    throw new TransformationError(diagnostic.message, [diagnostic]);
  }

  const diagnostics: Diagnostic[] = [];
  let shape: ObjectShape;

  if (Array.isArray(value)) {
    if (arrayRoot === "error") {
      const diagnostic = rootKindDiagnostic("an array");

      throw new TransformationError(diagnostic.message, [diagnostic]);
    }

    const fromArray = rootShapeFromArray(value);

    if (fromArray === undefined) {
      const diagnostic: Diagnostic = {
        severity: "error",
        code: "json/unsupported-root",
        message: "A root array must contain at least one object to describe.",
        line: 1,
        column: 1,
        hint: 'Wrap the value in an object, for example {"items": [...]}.',
      };

      throw new TransformationError(diagnostic.message, [diagnostic]);
    }

    shape = fromArray;

    diagnostics.push({
      severity: "info",
      code: "json/array-root",
      message: `The root value is an array, so "${rootName}" describes a single element.`,
    });
  } else if (value === null || typeof value !== "object") {
    const diagnostic = rootKindDiagnostic(describeValue(value));

    throw new TransformationError(diagnostic.message, [diagnostic]);
  } else {
    const inferred = inferShape(value);

    // typeof value === "object" and not an array, so this always holds.
    if (inferred.kind !== "object") {
      const diagnostic = rootKindDiagnostic(describeValue(value));

      throw new TransformationError(diagnostic.message, [diagnostic]);
    }

    shape = inferred;
  }

  const { root, context } = buildIr(shape, rootName);

  return { root, context, diagnostics };
}

export const jsonParser: SourceParser = {
  id: "json",
  irKind: "type-graph",
  label: "JSON",
  extensions: ["json"],
  parse: (input, options) => parseJson(input, options ?? {}),
  validate: validateJson,
};
