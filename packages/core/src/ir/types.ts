/**
 * The DevBridge intermediate representation (IR).
 *
 * Every source parser produces this shape and every target generator consumes
 * it. Adding a new target must therefore be a generator task only — see the
 * blueprint, section 14.
 */

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

export interface UnionNode {
  readonly kind: "union";
  readonly types: readonly TypeNode[];
}

export type TypeNode = PrimitiveNode | ObjectNode | ArrayNode | UnionNode;

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
    case "array":
      return `array:${typeKey(node.elementType)}`;
    case "union":
      return `union:${[...node.types.map(typeKey)].sort().join("|")}`;
  }
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
