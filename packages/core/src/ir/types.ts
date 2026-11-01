/**
 * The DevBridge intermediate representation (IR).
 *
 * Every source parser produces this shape and every target generator consumes
 * it. Adding a new target must therefore be a generator task only — see the
 * blueprint, section 14.
 */

import { NameAllocator, toPascalCase } from "../naming/index.js";

/**
 * `integer` is a whole number that fits in 32 bits; `long` is one that does
 * not. JSON itself draws no such line — it has a single `number` type — but
 * every statically typed target does, and silently mapping a 13-digit id onto
 * a 32-bit `int` overflows it. The distinction is therefore made here, once,
 * rather than guessed by five generators.
 */
export type PrimitiveType =
  | "string"
  | "integer"
  | "long"
  | "number"
  | "boolean"
  | "null"
  | "unknown";

/** Largest and smallest whole numbers representable in a signed 32-bit int. */
export const INT32_MAX = 2147483647;
export const INT32_MIN = -2147483648;

/** Classifies a whole number as `integer` or `long` by magnitude. */
export function integerWidth(value: number): "integer" | "long" {
  return value > INT32_MAX || value < INT32_MIN ? "long" : "integer";
}

export interface PrimitiveNode {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
}

export interface ObjectProperty {
  /** The property name exactly as it appeared in the source artifact. */
  readonly name: string;
  readonly value: TypeNode;
  /** True when the property was absent from at least one observed sample. */
  readonly optional: boolean;
}

export interface ObjectNode {
  readonly kind: "object";
  /** Unique, collision-free type name assigned by the parser. */
  readonly name: string;
  readonly properties: readonly ObjectProperty[];
}

export interface ArrayNode {
  readonly kind: "array";
  readonly elementType: TypeNode;
}

/**
 * One member of an enum: the value as it travels on the wire, and an
 * identifier-shaped name for it.
 *
 * The two are separate because they are rarely the same. A wire value of
 * `"n/a"` or `"2xx"` is not an identifier in any target language, and even an
 * ordinary `"available"` is written `AVAILABLE` in Java and `Available` in
 * C#. So the IR carries a neutral PascalCase name, which each generator
 * re-cases with the shared naming helpers, alongside the value that must be
 * preserved exactly.
 */
export interface EnumMember {
  /** Neutral PascalCase name, for example `Available` or `Value1`. */
  readonly name: string;
  /** The value exactly as the source declares it. */
  readonly value: string | number;
}

/**
 * A closed set of permitted values, as a named type.
 *
 * Only a source that *declares* one can produce this: a schema's `enum`
 * keyword states that the set is closed, where a JSON sample can only show
 * values that happened to occur. Inferring an enum from samples would be a
 * guess about the future, so the JSON parser does not, and this node is
 * reached today from OpenAPI alone.
 *
 * It is a named type like `ObjectNode` rather than a structural one, because
 * every target declares it: `enum Status`, `type Status string`, or a union
 * of literals. Names therefore share one namespace with object types.
 */
export interface EnumNode {
  readonly kind: "enum";
  /** Unique, collision-free type name assigned by the parser. */
  readonly name: string;
  /** What the values are, which decides the declared base in most targets. */
  readonly baseType: "string" | "integer";
  readonly members: readonly EnumMember[];
}

export interface UnionNode {
  readonly kind: "union";
  readonly types: readonly TypeNode[];
}

export type TypeNode =
  | PrimitiveNode
  | ObjectNode
  | ArrayNode
  | UnionNode
  | EnumNode;

export const PRIMITIVE_NODES: {
  readonly [K in PrimitiveType]: PrimitiveNode;
} = {
  string: { kind: "primitive", type: "string" },
  integer: { kind: "primitive", type: "integer" },
  long: { kind: "primitive", type: "long" },
  number: { kind: "primitive", type: "number" },
  boolean: { kind: "primitive", type: "boolean" },
  null: { kind: "primitive", type: "null" },
  unknown: { kind: "primitive", type: "unknown" },
};

export function primitive(type: PrimitiveType): PrimitiveNode {
  return PRIMITIVE_NODES[type];
}

export function isNullNode(node: TypeNode): boolean {
  return node.kind === "primitive" && node.type === "null";
}

/**
 * Stable structural key for a node. Used to deduplicate union members and to
 * compare property types across samples.
 */
export function typeKey(node: TypeNode): string {
  switch (node.kind) {
    case "primitive":
      return `primitive:${node.type}`;
    case "object":
      return `object:${node.name}`;
    case "enum":
      return `enum:${node.name}`;
    case "array":
      return `array:${typeKey(node.elementType)}`;
    case "union":
      return `union:${node.types.map(typeKey).sort().join("|")}`;
  }
}

/**
 * Builds enum members from raw declared values.
 *
 * Naming is the whole job here. A value may be unusable as an identifier
 * (`"n/a"`, `"2xx"`, `""`), two values may reduce to the same identifier
 * (`"a-b"` and `"a_b"`), and a numeric value has no name at all — so one
 * allocator hands out unique names and anything with no usable characters
 * falls back to a positional `Value<n>`.
 *
 * Returns `undefined` when the values are not a usable enum: empty, or mixed
 * across types, which no target can declare as one.
 */
export function enumMembersFrom(
  values: readonly unknown[],
): { baseType: "string" | "integer"; members: EnumMember[] } | undefined {
  const usable = values.filter(
    (value): value is string | number =>
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)),
  );

  if (usable.length === 0 || usable.length !== values.length) {
    return undefined;
  }

  const strings = usable.filter((value) => typeof value === "string");

  if (strings.length !== 0 && strings.length !== usable.length) {
    return undefined;
  }

  const baseType = strings.length === usable.length ? "string" : "integer";

  if (baseType === "integer" && usable.some((value) => !Number.isInteger(value))) {
    return undefined;
  }

  const allocator = new NameAllocator();

  const members = usable.map((value, index) => {
    const base =
      typeof value === "number"
        ? `Value${value < 0 ? `Minus${Math.abs(value)}` : value}`
        : toPascalCase(value);

    const preferred =
      base.length === 0 || /^[0-9]/.test(base) ? `Value${index + 1}` : base;

    return { name: allocator.allocate(preferred), value };
  });

  return { baseType, members };
}

/** Returns the union members of a node, or the node itself when it is not a union. */
export function unionMembers(node: TypeNode): readonly TypeNode[] {
  return node.kind === "union" ? node.types : [node];
}

/**
 * Splits a node into its non-null members plus a nullability flag, which is
 * what most statically typed targets actually need.
 */
export function splitNullable(node: TypeNode): {
  nullable: boolean;
  type: TypeNode;
} {
  const members = unionMembers(node);
  const nonNull = members.filter((member) => !isNullNode(member));

  if (nonNull.length === members.length) {
    return { nullable: false, type: node };
  }

  if (nonNull.length === 0) {
    return { nullable: true, type: primitive("null") };
  }

  if (nonNull.length === 1) {
    return { nullable: true, type: nonNull[0] as TypeNode };
  }

  return { nullable: true, type: { kind: "union", types: nonNull } };
}
