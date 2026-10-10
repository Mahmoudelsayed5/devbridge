import type { PrimitiveType } from "@devbridge/core";

/**
 * An inferred structural description of a JSON value.
 *
 * Shapes are the parser's working representation: unlike the IR they carry no
 * names and they can be merged with each other. Merging is what makes
 * `[{a:1},{a:1,b:2}]` collapse into one item type with an optional `b`, at any
 * nesting depth.
 */
export type Shape = PrimitiveShape | ObjectShape | ArrayShape | UnionShape;

export interface PrimitiveShape {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
}

export interface PropertyShape {
  shape: Shape;
  /** How many of the merged samples contained this property. */
  present: number;
  /** Discovery order, so output follows the source document. */
  readonly order: number;
}

export interface ObjectShape {
  readonly kind: "object";
  /** How many object samples were merged into this shape. */
  samples: number;
  readonly properties: Map<string, PropertyShape>;
}

export interface ArrayShape {
  readonly kind: "array";
  /** `undefined` means every merged sample was an empty array. */
  element: Shape | undefined;
}

export interface UnionShape {
  readonly kind: "union";
  /**
   * At most one object member and at most one array member, because those are
   * merged structurally. Primitives are deduplicated.
   */
  readonly members: Shape[];
}

function primitiveShape(type: PrimitiveType): PrimitiveShape {
  return { kind: "primitive", type };
}

/** Infers the shape of a single parsed JSON value. */
export function inferShape(value: unknown): Shape {
  if (value === null) {
    return primitiveShape("null");
  }

  switch (typeof value) {
    case "string":
      return primitiveShape("string");
    case "boolean":
      return primitiveShape("boolean");
    case "number":
      return primitiveShape(Number.isInteger(value) ? "integer" : "number");
    case "object":
      break;
    default:
      // JSON.parse never produces undefined, functions or symbols.
      return primitiveShape("unknown");
  }

  if (Array.isArray(value)) {
    let element: Shape | undefined;

    for (const item of value) {
      const itemShape = inferShape(item);

      element = element === undefined ? itemShape : mergeShapes(element, itemShape);
    }

    return { kind: "array", element };
  }

  const properties = new Map<string, PropertyShape>();
  let order = 0;

  for (const [name, propertyValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    properties.set(name, {
      shape: inferShape(propertyValue),
      present: 1,
      order: order++,
    });
  }

  return { kind: "object", samples: 1, properties };
}

/**
 * Widens two primitive types into one, or returns undefined when they are not
 * compatible. `integer` widens to `number` so `[1, 1.5]` is `number[]` rather
 * than `(number | number)[]`.
 */
function widenPrimitive(
  a: PrimitiveType,
  b: PrimitiveType,
): PrimitiveType | undefined {
  if (a === b) {
    return a;
  }

  if (a === "unknown") {
    return b;
  }

  if (b === "unknown") {
    return a;
  }

  if (
    (a === "integer" && b === "number") ||
    (a === "number" && b === "integer")
  ) {
    return "number";
  }

  return undefined;
}

/** Merges `addition` into an existing list of union members, in place. */
function addToUnion(members: Shape[], addition: Shape): void {
  if (addition.kind === "union") {
    for (const member of addition.members) {
      addToUnion(members, member);
    }

    return;
  }

  const index = members.findIndex((member) => {
    if (member.kind !== addition.kind) {
      return false;
    }

    if (member.kind === "primitive" && addition.kind === "primitive") {
      return widenPrimitive(member.type, addition.type) !== undefined;
    }

    // Objects and arrays merge structurally, so there is only ever one of each.
    return true;
  });

  if (index === -1) {
    members.push(addition);

    return;
  }

  members[index] = mergeShapes(members[index] as Shape, addition);
}

/**
 * Combines two shapes observed in the same position.
 *
 * The result is deterministic and order-independent for property sets: the
 * union of both property sets, where a property missing from either side is
 * reported as present in fewer samples than the total.
 */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (a === b) {
    return a;
  }

  if (a.kind === "union" || b.kind === "union") {
    const members: Shape[] = [];

    addToUnion(members, a);
    addToUnion(members, b);

    return members.length === 1 ? (members[0] as Shape) : { kind: "union", members };
  }

  if (a.kind === "primitive" && b.kind === "primitive") {
    const widened = widenPrimitive(a.type, b.type);

    return widened === undefined
      ? { kind: "union", members: [a, b] }
      : primitiveShape(widened);
  }

  if (a.kind === "array" && b.kind === "array") {
    if (a.element === undefined) {
      return { kind: "array", element: b.element };
    }

    if (b.element === undefined) {
      return { kind: "array", element: a.element };
    }

    return { kind: "array", element: mergeShapes(a.element, b.element) };
  }

  if (a.kind === "object" && b.kind === "object") {
    return mergeObjectShapes(a, b);
  }

  return { kind: "union", members: [a, b] };
}

function mergeObjectShapes(a: ObjectShape, b: ObjectShape): ObjectShape {
  const samples = a.samples + b.samples;
  const properties = new Map<string, PropertyShape>();
  let order = 0;

  for (const [name, property] of a.properties) {
    properties.set(name, {
      shape: property.shape,
      present: property.present,
      order: order++,
    });
  }

  for (const [name, property] of b.properties) {
    const existing = properties.get(name);

    if (existing === undefined) {
      properties.set(name, {
        shape: property.shape,
        present: property.present,
        order: order++,
      });

      continue;
    }

    existing.shape = mergeShapes(existing.shape, property.shape);
    existing.present += property.present;
  }

  return { kind: "object", samples, properties };
}

/** Properties in discovery order. */
export function orderedProperties(
  shape: ObjectShape,
): { name: string; property: PropertyShape }[] {
  return [...shape.properties.entries()]
    .map(([name, property]) => ({ name, property }))
    .sort((left, right) => left.property.order - right.property.order);
}
