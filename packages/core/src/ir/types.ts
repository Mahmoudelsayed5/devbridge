export type PrimitiveType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "unknown";

export interface PrimitiveNode {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
}

export interface ObjectProperty {
  readonly name: string;
  readonly value: TypeNode;
  readonly optional: boolean;
}

export interface ObjectNode {
  readonly kind: "object";
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
