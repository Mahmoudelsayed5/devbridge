/**
 * Reads `components/schemas` as the type-graph IR, so an OpenAPI document can
 * also produce TypeScript, Java, Go, Python and C# models.
 *
 * This is the same IR the JSON parser produces, and that is the point: the
 * five language generators are reused untouched. What differs is the quality
 * of the information available, and in three places it is strictly better
 * than anything inference from samples can reach.
 *
 * **Names are given, not guessed.** The JSON parser sees two structurally
 * identical objects and must decide whether they are one type or two; it
 * resolves that with contextual naming (`OrderCustomer`, `InvoiceCustomer`).
 * A `$ref` states the answer outright, so two references to
 * `#/components/schemas/Customer` become one `Customer` type used twice.
 *
 * **Optionality is declared, not counted.** The JSON parser infers optional
 * from "absent in at least one sample", which is only as good as the samples.
 * OpenAPI has a `required` list.
 *
 * **Integer width is stated.** `format: int64` says plainly that a field does
 * not fit in 32 bits, where a sample containing 42 cannot. That removes the
 * guess that `integerWidth` exists to make for JSON.
 *
 * Recursion is also representable here for the same reason: `$ref` is a link
 * by name, so a tree node whose children are tree nodes is an ordinary cycle
 * in the graph rather than an infinite sample.
 */

import type {
  Diagnostic,
  EnumNode,
  ObjectNode,
  ObjectProperty,
  ParseOptions,
  ParseResult,
  PrimitiveType,
  TypeNode,
} from "@devbridge/core";
import {
  NameAllocator,
  TransformationContext,
  TransformationError,
  enumMembersFrom,
  primitive,
  sanitizeIdentifier,
  toPascalCase,
  typeKey,
} from "@devbridge/core";

import {
  NO_SCHEMAS,
  record,
  readDocument,
  schemasOf,
  validateDocument,
} from "./document.js";
import { deref } from "./schema.js";

/** Guards against a pathologically deep inline schema. */
const MAX_DEPTH = 12;

const SCHEMA_REF_PREFIX = "#/components/schemas/";

/**
 * An object node before its properties are known.
 *
 * `ObjectNode.properties` is readonly, and deliberately so — but a reference
 * cycle has to hand out the node before it can be filled in. This is the one
 * place that writes to it, between registering the placeholder and completing
 * it; everything downstream sees a finished `ObjectNode`.
 */
interface PendingObject {
  readonly kind: "object";
  readonly name: string;
  properties: readonly ObjectProperty[];
}

/** Everything one parse needs to pass around. */
interface Build {
  readonly document: unknown;
  readonly context: TransformationContext;
  readonly allocator: NameAllocator;
  readonly diagnostics: Diagnostic[];
  /** Schema key (as written in the document) to the type name chosen for it. */
  readonly names: Map<string, string>;
  /** Placeholder object nodes, completed in place once their properties are built. */
  readonly objects: Map<string, PendingObject>;
  /** Memoised node per schema key, so a `$ref` is resolved once. */
  readonly resolved: Map<string, TypeNode>;
  /** Keys currently being built, to break reference cycles. */
  readonly building: Set<string>;
}

function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringsOf(value: unknown): string[] {
  return (array(value) ?? []).filter(
    (entry): entry is string => typeof entry === "string",
  );
}

/** The declared `type`, accepting OpenAPI 3.1's array form. */
function declaredTypes(schema: Record<string, unknown>): string[] {
  const type = schema["type"];

  if (typeof type === "string") {
    return [type];
  }

  return stringsOf(type);
}

/**
 * True when the schema permits null.
 *
 * OpenAPI 3.0 spells this `nullable: true`; 3.1 dropped that in favour of
 * JSON Schema's `type: ["string", "null"]`. Both appear in the wild, often in
 * documents claiming to be the other version, so both are accepted.
 */
function isNullable(schema: Record<string, unknown>): boolean {
  return (
    schema["nullable"] === true ||
    declaredTypes(schema).includes("null") ||
    // A `null` among the enum values is a third spelling of the same thing:
    // it widens what the field accepts rather than adding a member, and no
    // target can declare `null` as an enum constant anyway.
    (array(schema["enum"]) ?? []).includes(null)
  );
}

function withNull(node: TypeNode): TypeNode {
  if (node.kind === "union") {
    return node.types.some(
      (member) => member.kind === "primitive" && member.type === "null",
    )
      ? node
      : { kind: "union", types: [...node.types, primitive("null")] };
  }

  return node.kind === "primitive" && node.type === "null"
    ? node
    : { kind: "union", types: [node, primitive("null")] };
}

/**
 * Maps a declared scalar type onto the IR.
 *
 * The `integer` case is the one worth reading: OpenAPI states the width, so
 * unlike JSON this is a fact rather than an inference from magnitude.
 */
function scalarNode(
  type: string,
  schema: Record<string, unknown>,
): PrimitiveType {
  switch (type) {
    case "string":
      return "string";
    case "integer":
      return schema["format"] === "int64" ? "long" : "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return "unknown";
  }
}

/** The declared `enum` values, or undefined when the schema has none. */
function enumValuesOf(schema: Record<string, unknown>): unknown[] | undefined {
  const values = array(schema["enum"]);

  return values === undefined || values.length === 0 ? undefined : values;
}

/**
 * Builds a named enum for a schema's `enum` keyword.
 *
 * `null` among the values means the enum is nullable rather than that `null`
 * is a member, so it is stripped here and the caller's nullability handling
 * picks it up — `nullable: true` and a `null` member mean the same thing.
 *
 * Returns undefined when the values cannot be one enum (mixed types, say), in
 * which case the caller falls back to a plain scalar: a loose approximation
 * beats refusing the document over a detail of one field.
 */
function enumNodeFor(
  build: Build,
  values: readonly unknown[],
  name: string,
): EnumNode | undefined {
  const withoutNull = values.filter((value) => value !== null);
  const built = enumMembersFrom(withoutNull);

  if (built === undefined) {
    build.diagnostics.push({
      severity: "warning",
      code: "openapi/mixed-enum",
      message: `"${name}" has enum values of more than one type, which no target can declare as a single enum; it becomes a plain value.`,
      hint: "Split it into separate schemas, one per value type.",
    });

    return undefined;
  }

  // An integer enum whose schema says `format: int64` is still an enum of
  // whole numbers; the IR records only that the base is integral.
  const node: EnumNode = {
    kind: "enum",
    name,
    baseType: built.baseType,
    members: built.members,
  };

  build.context.registerEnum(node);

  return node;
}

/** Infers a type from `enum` members when the schema omits `type`. */
function enumType(values: readonly unknown[]): PrimitiveType {
  const kinds = new Set(
    values
      .filter((value) => value !== null)
      .map((value) =>
        typeof value === "number"
          ? Number.isInteger(value)
            ? "integer"
            : "number"
          : typeof value,
      ),
  );

  if (kinds.size !== 1) {
    return "unknown";
  }

  const [only] = [...kinds];

  switch (only) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

/**
 * Flattens `allOf` into one property set.
 *
 * `allOf` is how OpenAPI 3.0 spells inheritance, and a generated model is far
 * more useful with the inherited fields present than with an empty shell that
 * refers to nothing. The IR has no notion of a base type, so the branches are
 * merged: later branches win on a repeated property name, and `required` is
 * the union across all of them.
 */
function flattenAllOf(
  build: Build,
  schema: Record<string, unknown>,
  depth: number,
): { properties: Map<string, unknown>; required: Set<string> } {
  const properties = new Map<string, unknown>();
  const required = new Set<string>(stringsOf(schema["required"]));

  for (const branch of array(schema["allOf"]) ?? []) {
    const resolved = deref(build.document, branch);

    if (resolved === undefined || depth > MAX_DEPTH) {
      continue;
    }

    const inner = flattenAllOf(
      build,
      resolved as Record<string, unknown>,
      depth + 1,
    );

    for (const [name, property] of inner.properties) {
      properties.set(name, property);
    }

    for (const name of inner.required) {
      required.add(name);
    }
  }

  const own = record(schema["properties"]);

  if (own !== undefined) {
    for (const [name, property] of Object.entries(own)) {
      properties.set(name, property);
    }
  }

  return { properties, required };
}

/** Builds the object node for a schema with properties. */
function objectNode(
  build: Build,
  schema: Record<string, unknown>,
  name: string,
  depth: number,
): ObjectNode {
  const { properties, required } = flattenAllOf(build, schema, depth);

  const members: ObjectProperty[] = [...properties].map(
    ([propertyName, property]) => ({
      name: propertyName,
      value: nodeFor(
        build,
        property,
        `${name}${toPascalCase(propertyName)}`,
        depth + 1,
      ),
      optional: !required.has(propertyName),
    }),
  );

  return { kind: "object", name, properties: members };
}

/** True when a schema should become a named object type. */
function isObjectLike(build: Build, raw: unknown, depth = 0): boolean {
  const schema = deref(build.document, raw);

  if (schema === undefined || depth > MAX_DEPTH) {
    return false;
  }

  const asRecord = schema as Record<string, unknown>;

  if (record(asRecord["properties"]) !== undefined) {
    return true;
  }

  // An allOf whose branches carry the properties is still an object.
  return (array(asRecord["allOf"]) ?? []).some((branch) =>
    isObjectLike(build, branch, depth + 1),
  );
}

/**
 * Resolves a reference to a top-level schema to the type built for it.
 *
 * This is where recursion is handled: a key still being built returns its
 * placeholder object, which is completed in place later, so `Node.children:
 * Node[]` terminates instead of recursing forever.
 */
function nodeForKey(build: Build, key: string, depth: number): TypeNode {
  const memo = build.resolved.get(key);

  if (memo !== undefined) {
    return memo;
  }

  const placeholder = build.objects.get(key);

  if (build.building.has(key)) {
    return placeholder ?? primitive("unknown");
  }

  const schemas = schemasOf(build.document);
  const schema = record(schemas?.[key]);

  if (schema === undefined) {
    return primitive("unknown");
  }

  build.building.add(key);

  const name = build.names.get(key) as string;
  let node: TypeNode;

  if (placeholder !== undefined) {
    const built = objectNode(build, schema, name, depth);

    // Complete the placeholder in place: anything that already captured a
    // reference to it during a cycle sees the finished properties.
    placeholder.properties = built.properties;

    build.context.registerType(placeholder);
    node = placeholder;
  } else {
    // A schema that is not object-like — a string alias, an enum, an array of
    // something — has no place of its own in the IR, which has no type
    // aliases. References to it inline the underlying type instead.
    node = buildNode(build, schema, name, depth, name);
  }

  build.building.delete(key);
  build.resolved.set(key, node);

  return node;
}

/** The schema key a `$ref` points at, when it points into components/schemas. */
function refKey(raw: unknown): string | undefined {
  const ref = record(raw)?.["$ref"];

  if (typeof ref !== "string" || !ref.startsWith(SCHEMA_REF_PREFIX)) {
    return undefined;
  }

  return ref
    .slice(SCHEMA_REF_PREFIX.length)
    .replace(/~1/g, "/")
    .replace(/~0/g, "~");
}

/** Converts any schema to a node, following references by name. */
function nodeFor(
  build: Build,
  raw: unknown,
  nameHint: string,
  depth: number,
): TypeNode {
  if (depth > MAX_DEPTH) {
    return primitive("unknown");
  }

  const key = refKey(raw);

  if (key !== undefined && build.names.has(key)) {
    return nodeForKey(build, key, depth);
  }

  // A reference to somewhere else in the document (a parameter schema, say).
  const schema = deref(build.document, raw);

  if (schema === undefined) {
    return primitive("unknown");
  }

  return buildNode(build, schema as Record<string, unknown>, nameHint, depth);
}

function buildNode(
  build: Build,
  schema: Record<string, unknown>,
  nameHint: string,
  depth: number,
  ownName?: string,
): TypeNode {
  const node = buildBare(build, schema, nameHint, depth, ownName);

  return isNullable(schema) ? withNull(node) : node;
}

/**
 * @param ownName the name already allocated for this schema, when it is a
 * top-level one. Passing it stops a second name being handed out for the
 * same type — `Status` becoming `Status2`.
 */
function buildBare(
  build: Build,
  schema: Record<string, unknown>,
  nameHint: string,
  depth: number,
  ownName?: string,
): TypeNode {
  const types = declaredTypes(schema).filter((type) => type !== "null");

  // oneOf / anyOf become a union. The IR cannot express a discriminator, so
  // the branches are kept and the discriminator property, if any, survives
  // only as a property of whichever branches declare it.
  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = array(schema[key]);

    if (branches !== undefined && branches.length > 0) {
      const members = branches.map((branch, index) =>
        nodeFor(build, branch, `${nameHint}${index + 1}`, depth + 1),
      );

      const unique = [...new Map(members.map((m) => [typeKey(m), m])).values()];

      return unique.length === 1
        ? (unique[0] as TypeNode)
        : { kind: "union", types: unique };
    }
  }

  if (types.includes("array") || schema["items"] !== undefined) {
    return {
      kind: "array",
      elementType: nodeFor(
        build,
        schema["items"],
        `${nameHint}Item`,
        depth + 1,
      ),
    };
  }

  if (isObjectLike(build, schema, depth)) {
    const name = build.allocator.allocate(
      sanitizeIdentifier(nameHint, { fallback: "Type" }),
    );

    const built = objectNode(build, schema, name, depth);

    build.context.registerType(built);

    return built;
  }

  // An object with no properties: either a free-form object or a map. The IR
  // has neither, so it degrades to `unknown` — which every target renders as
  // its own permissive type — and says so rather than pretending.
  if (types.includes("object") || schema["additionalProperties"] !== undefined) {
    const isMap = record(schema["additionalProperties"]) !== undefined;

    build.diagnostics.push({
      severity: "warning",
      code: isMap ? "openapi/map-schema" : "openapi/free-form-object",
      message: isMap
        ? `"${nameHint}" is a map (additionalProperties), which the type graph cannot express; it becomes an untyped value.`
        : `"${nameHint}" is an object with no declared properties; it becomes an untyped value.`,
      hint: isMap
        ? "Generated code will use the target's permissive type. Declare the value type as a named schema if you need it."
        : "Declare its properties to have them generated.",
    });

    return primitive("unknown");
  }

  const enumValues = enumValuesOf(schema);

  if (enumValues !== undefined) {
    // Checked before the scalar cases: `type: string` with an `enum` is an
    // enum, not a string, and the closed set is the more useful fact.
    const node = enumNodeFor(
      build,
      enumValues,
      ownName ??
        build.allocator.allocate(
          sanitizeIdentifier(nameHint, { fallback: "Enum" }),
        ),
    );

    if (node !== undefined) {
      return node;
    }

    // Not expressible as one enum; fall through to the base type.
    return primitive(
      types.length === 1
        ? scalarNode(types[0] as string, schema)
        : enumType(enumValues),
    );
  }

  if (types.length === 0) {
    return primitive("unknown");
  }

  if (types.length === 1) {
    return primitive(scalarNode(types[0] as string, schema));
  }

  const members = types.map((type) => primitive(scalarNode(type, schema)));

  return { kind: "union", types: [...new Map(members.map((m) => [typeKey(m), m])).values()] };
}

/**
 * Parses the `components/schemas` half of an OpenAPI document into the
 * type-graph IR.
 *
 * @throws {TransformationError} when the document cannot be read or declares
 * no reusable schemas.
 */
export function parseOpenApiSchemas(
  input: string,
  _options: ParseOptions = {},
): ParseResult {
  const problems = validateDocument(input);
  const blocking = problems.find((problem) => problem.severity === "error");

  if (blocking !== undefined) {
    throw new TransformationError(blocking.message, [blocking]);
  }

  const { document } = readDocument(input);
  const schemas = schemasOf(document);

  if (schemas === undefined) {
    throw new TransformationError(NO_SCHEMAS.message, [NO_SCHEMAS]);
  }

  const build: Build = {
    document,
    context: new TransformationContext(),
    allocator: new NameAllocator(),
    diagnostics: [],
    names: new Map(),
    objects: new Map(),
    resolved: new Map(),
    building: new Set(),
  };

  // Names first, for every key, so that a `$ref` resolves to a stable name
  // regardless of the order the schemas are written in.
  for (const key of Object.keys(schemas)) {
    const name = build.allocator.allocate(
      sanitizeIdentifier(toPascalCase(key), { fallback: "Type" }),
    );

    build.names.set(key, name);
  }

  // Then placeholders for the object-like ones, so a cycle has something to
  // point at before its properties exist.
  for (const [key, schema] of Object.entries(schemas)) {
    if (isObjectLike(build, schema)) {
      const placeholder: PendingObject = {
        kind: "object",
        name: build.names.get(key) as string,
        properties: [],
      };

      build.objects.set(key, placeholder);
      build.context.registerType(placeholder);
    }
  }

  for (const key of Object.keys(schemas)) {
    nodeForKey(build, key, 0);
  }

  const types = build.context.getTypes();

  if (types.length === 0) {
    // An enum-only document is a real artifact — a shared file of status
    // values — but `ParseResult.root` is an `ObjectNode`, so there is nothing
    // honest to return. Say exactly that rather than inventing an empty
    // wrapper type the document does not contain.
    const enumOnly = build.context.getEnums().length > 0;

    const message = enumOnly
      ? "The document's schemas are all enums, and a transformation needs at least one object type to anchor the output."
      : "None of the document's schemas describe an object, so there are no models to generate.";

    throw new TransformationError(message, [
      {
        severity: "error",
        code: enumOnly ? "openapi/enums-only" : "openapi/no-object-schemas",
        message,
        line: 1,
        column: 1,
        hint: enumOnly
          ? "Add a schema that uses them, or generate from a document that has one."
          : "The type graph has no type aliases, so a schema like `type: string` produces nothing on its own.",
      },
    ]);
  }

  // The first schema becomes the root. Every generator emits each type in the
  // context and uses the root only for ordering, so this avoids inventing a
  // synthetic wrapper type that is not in the document.
  const root = types[0] as ObjectNode;

  // Schemas that produced no type of their own. An enum counts as a type, so
  // only true aliases — `Email: {type: string}` — are listed here.
  const skipped = [...build.names.entries()].filter(
    ([key, name]) =>
      !build.objects.has(key) && !build.context.hasEnum(name),
  );

  if (skipped.length > 0) {
    build.diagnostics.push({
      severity: "info",
      code: "openapi/alias-schema",
      message: `${skipped.length === 1 ? "Schema" : "Schemas"} ${skipped
        .map(([key]) => `"${key}"`)
        .join(", ")} ${skipped.length === 1 ? "describes" : "describe"} a value rather than an object, so ${skipped.length === 1 ? "it has" : "they have"} no generated type of ${skipped.length === 1 ? "its" : "their"} own.`,
      hint: "References to them use the underlying type directly.",
    });
  }

  return { root, context: build.context, diagnostics: build.diagnostics };
}

/** Reports what would stop `parseOpenApiSchemas` from producing IR. */
export function validateOpenApiSchemas(input: string): readonly Diagnostic[] {
  const problems = validateDocument(input);

  if (problems.length > 0) {
    return problems;
  }

  return schemasOf(readDocument(input).document) === undefined
    ? [NO_SCHEMAS]
    : [];
}
