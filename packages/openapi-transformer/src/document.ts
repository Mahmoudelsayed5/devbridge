/**
 * Reading and sanity-checking the document itself, shared by both readings of
 * it.
 *
 * An OpenAPI document describes two different things at once: its `paths` are
 * HTTP endpoints, and its `components/schemas` are data shapes. Which half
 * matters depends on what you asked for, so the checks that apply to *any*
 * reading live here, and each reading adds its own on top.
 */

import type { Diagnostic } from "@devbridge/core";
import { parse as parseYaml } from "yaml";

export const EMPTY_INPUT: Diagnostic = {
  severity: "error",
  code: "openapi/empty-input",
  message: "The input is empty.",
  line: 1,
  column: 1,
  hint: "Paste or load an OpenAPI document first.",
};

export const NOT_OPENAPI: Diagnostic = {
  severity: "error",
  code: "openapi/not-openapi",
  message: "This does not look like an OpenAPI document.",
  line: 1,
  column: 1,
  hint: 'An OpenAPI 3 document has a top-level "openapi" field, for example openapi: 3.0.3.',
};

export const SWAGGER_2: Diagnostic = {
  severity: "error",
  code: "openapi/swagger-2",
  message: "Swagger 2.0 documents are not supported; this reads OpenAPI 3.",
  line: 1,
  column: 1,
  hint: "Convert the document to OpenAPI 3 first, for example with swagger2openapi.",
};

export const NO_OPERATIONS: Diagnostic = {
  severity: "error",
  code: "openapi/no-operations",
  message: "The document declares no paths, so there is nothing to request.",
  line: 1,
  column: 1,
};

export const NO_SCHEMAS: Diagnostic = {
  severity: "error",
  code: "openapi/no-schemas",
  message:
    "The document declares no components/schemas, so there are no types to generate.",
  line: 1,
  column: 1,
  hint: "Generating models needs reusable schemas. A document with only inline request and response bodies can still produce a Postman collection.",
};

export const NO_CONTENT: Diagnostic = {
  severity: "error",
  code: "openapi/no-content",
  message:
    "The document declares neither paths nor components/schemas, so there is nothing to transform.",
  line: 1,
  column: 1,
};

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads the document as JSON or YAML.
 *
 * OpenAPI documents are written in both, roughly evenly, so supporting only
 * one would make the feature half useful. YAML is a superset of JSON, so one
 * parser covers both — but JSON is tried first because its errors are better.
 */
export function readDocument(input: string): {
  document: unknown;
  diagnostic?: Diagnostic;
} {
  const source = input.replace(/^﻿/, "");

  try {
    return { document: JSON.parse(source) };
  } catch {
    // Not JSON; fall through to YAML.
  }

  try {
    return { document: parseYaml(source) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The yaml package reports a line/col in its message; surface it as-is.
    const position = /at line (\d+), column (\d+)/.exec(message);

    return {
      document: undefined,
      diagnostic: {
        severity: "error",
        code: "openapi/invalid-syntax",
        message: message.split("\n")[0] ?? message,
        ...(position?.[1] === undefined
          ? {}
          : {
              line: Number(position[1]),
              column: Number(position[2]),
            }),
        hint: "The document must be valid JSON or YAML.",
      },
    };
  }
}

/** The `components/schemas` map, or undefined when the document has none. */
export function schemasOf(
  document: unknown,
): Record<string, unknown> | undefined {
  const schemas = record(record(record(document)?.["components"])?.["schemas"]);

  return schemas === undefined || Object.keys(schemas).length === 0
    ? undefined
    : schemas;
}

/** The `paths` map, or undefined when the document declares none. */
export function pathsOf(document: unknown): Record<string, unknown> | undefined {
  const paths = record(record(document)?.["paths"]);

  return paths === undefined || Object.keys(paths).length === 0
    ? undefined
    : paths;
}

/**
 * Checks what every reading of the document needs: that it parses, that it is
 * OpenAPI 3, and that it carries at least one of the two halves.
 *
 * Deliberately *not* checked here: that `paths` exists. A document of nothing
 * but reusable schemas is a real and common artifact — a shared model file —
 * and refusing it outright would make the language targets unreachable for
 * exactly the documents best suited to them.
 */
export function validateDocument(input: string): readonly Diagnostic[] {
  if (input.trim().length === 0) {
    return [EMPTY_INPUT];
  }

  const { document, diagnostic } = readDocument(input);

  if (diagnostic !== undefined) {
    return [diagnostic];
  }

  const root = record(document);

  if (root === undefined) {
    return [NOT_OPENAPI];
  }

  if (text(root["swagger"]) !== undefined) {
    return [SWAGGER_2];
  }

  if (text(root["openapi"]) === undefined) {
    return [NOT_OPENAPI];
  }

  if (pathsOf(document) === undefined && schemasOf(document) === undefined) {
    return [NO_CONTENT];
  }

  return [];
}
