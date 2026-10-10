/**
 * The DevBridge intermediate representation (IR).
 *
 * Every source parser produces this shape and every target generator consumes
 * it. Adding a new target must therefore be a generator task only — see the
 * blueprint, section 14.
 */

export type PrimitiveType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null"
  | "unknown";

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
