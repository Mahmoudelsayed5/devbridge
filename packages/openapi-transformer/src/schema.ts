/**
 * Just enough OpenAPI schema handling to produce useful example payloads.
 *
 * A Postman collection is most useful when each request arrives prefilled, so
 * the job here is not validation but synthesis: turn a schema into a concrete
 * example a developer can edit and send.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface SchemaLike {
  readonly [key: string]: unknown;
}

const MAX_DEPTH = 8;

/** Resolves a local `#/...` reference against the document. */
export function resolveRef(document: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  let current: unknown = document;

  for (const rawSegment of ref.slice(2).split("/")) {
    // JSON Pointer escapes: ~1 is "/" and ~0 is "~".
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");

    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Follows `$ref` until a concrete schema is reached. */
export function deref(
  document: unknown,
  schema: unknown,
  seen = new Set<string>(),
): SchemaLike | undefined {
  if (typeof schema !== "object" || schema === null) {
    return undefined;
  }

  const ref = (schema as Record<string, unknown>)["$ref"];

  if (typeof ref !== "string") {
    return schema as SchemaLike;
  }

  // A self-referential schema (a tree node, say) would otherwise loop.
  if (seen.has(ref)) {
    return undefined;
  }

  seen.add(ref);

  return deref(document, resolveRef(document, ref), seen);
}

function first<T>(value: unknown): T | undefined {
  return Array.isArray(value) && value.length > 0
    ? (value[0] as T)
    : undefined;
}

/**
 * Builds an example value for a schema.
 *
 * Prefers what the document states — `example`, `default`, the first `enum`
 * member — and falls back to a placeholder typical of the declared type, so
 * the result is always something concrete rather than a blank.
 */
export function exampleFor(
  document: unknown,
  rawSchema: unknown,
  depth = 0,
): Json {
  const schema = deref(document, rawSchema);

  if (schema === undefined || depth > MAX_DEPTH) {
    return null;
  }

  if (schema["example"] !== undefined) {
    return schema["example"] as Json;
  }

  if (schema["default"] !== undefined) {
    return schema["default"] as Json;
  }

  const enumValues = schema["enum"];

  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues[0] as Json;
  }

  // A composed schema is approximated by its first branch, which is enough
  // for a starting request body.
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const branch = first<unknown>(schema[key]);

    if (branch !== undefined) {
      return exampleFor(document, branch, depth + 1);
    }
  }

  const type = typeof schema["type"] === "string" ? (schema["type"] as string) : undefined;

  if (type === "array" || schema["items"] !== undefined) {
    return [exampleFor(document, schema["items"], depth + 1)];
  }

  if (type === "object" || schema["properties"] !== undefined) {
    const properties = schema["properties"];
    const result: Record<string, Json> = {};

    if (typeof properties === "object" && properties !== null) {
      for (const [name, property] of Object.entries(
        properties as Record<string, unknown>,
      )) {
        result[name] = exampleFor(document, property, depth + 1);
      }
    }

    return result;
  }

  switch (type) {
    case "string":
      return exampleString(schema);
    case "integer":
      return 0;
    case "number":
      return 0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return null;
  }
}

function exampleString(schema: SchemaLike): string {
  const format = schema["format"];

  switch (format) {
    case "date-time":
      return "2026-01-01T00:00:00Z";
    case "date":
      return "2026-01-01";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "password":
      return "password";
    case "byte":
      return "ZXhhbXBsZQ==";
    default:
      return "string";
  }
}

/** A short human-readable rendering of a schema's type. */
export function describeType(document: unknown, rawSchema: unknown): string | undefined {
  const schema = deref(document, rawSchema);

  if (schema === undefined) {
    return undefined;
  }

  const type = schema["type"];

  if (type === "array") {
    const inner = describeType(document, schema["items"]);

    return `${inner ?? "any"}[]`;
  }

  if (typeof type === "string") {
    const format = schema["format"];

    return typeof format === "string" ? `${type} (${format})` : type;
  }

  return undefined;
}

/** A scalar parameter value rendered as text for prefilling. */
export function scalarExample(
  document: unknown,
  rawSchema: unknown,
): string | undefined {
  const value = exampleFor(document, rawSchema);

  if (value === null || typeof value === "object") {
    return undefined;
  }

  return String(value);
}
