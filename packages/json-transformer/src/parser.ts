import type {
  ArrayNode,
  ObjectNode,
  PrimitiveNode,
  TypeNode,
} from "@devbridge/core";

import { TransformationContext } from "@devbridge/core";

export function parseJson(
  input: string,
  rootName = "Root",
): {
  root: ObjectNode;
  context: TransformationContext;
} {
  const value: unknown = JSON.parse(input);

  const context = new TransformationContext();

  const root = parseValue(value, rootName, context);

  if (root.kind !== "object") {
    throw new Error("JSON root must be an object");
  }

  return {
    root,
    context,
  };
}

function parseValue(
  value: unknown,
  name: string,
  context: TransformationContext,
  parentName?: string,
): TypeNode {
  if (value === null) {
    const node: PrimitiveNode = {
      kind: "primitive",
      type: "null",
    };

    return node;
  }
  if (typeof value === "string") {
    return {
      kind: "primitive",
      type: "string",
    };
  }

  if (typeof value === "number") {
    return {
      kind: "primitive",
      type: "number",
    };
  }

  if (typeof value === "boolean") {
    return {
      kind: "primitive",
      type: "boolean",
    };
  }

  if (Array.isArray(value)) {
    return parseArray(value, name, context, parentName);
  }

  if (typeof value === "object") {
    return parseObject(
      value as Record<string, unknown>,
      name,
      context,
      parentName,
    );
  }

  throw new Error(`Unsupported JSON value: ${typeof value}`);
}

function parseArray(
  values: unknown[],
  name: string,
  context: TransformationContext,
  parentName?: string,
): ArrayNode {
  if (values.length === 0) {
    return {
      kind: "array",
      elementType: {
        kind: "primitive",
        type: "unknown",
      },
    };
  }

  const objectValues = values.filter(
    (value): value is Record<string, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value),
  );

  if (objectValues.length === values.length) {
    const objectType = mergeObjectArray(
      objectValues,
      name,
      context,
      parentName,
    );

    return {
      kind: "array",
      elementType: objectType,
    };
  }

  const elementTypes = values.map((value) =>
    parseValue(value, `${name}Item`, context),
  );

  const uniqueTypes = new Map<string, TypeNode>();

  for (const type of elementTypes) {
    uniqueTypes.set(typeKey(type), type);
  }

  const types = [...uniqueTypes.values()];

  return {
    kind: "array",
    elementType:
      types.length === 1
        ? types[0]
        : {
            kind: "union",
            types,
          },
  };
}

function mergeObjectArray(
  values: Record<string, unknown>[],
  name: string,
  context: TransformationContext,
  parentName?: string,
): ObjectNode {
  const baseName =
    parentName && parentName !== "Root" ? `${parentName}${name}` : name;

  const typeName = `${baseName}Item`;

  const allPropertyNames = new Set<string>();

  for (const value of values) {
    for (const propertyName of Object.keys(value)) {
      allPropertyNames.add(propertyName);
    }
  }

  const properties = [...allPropertyNames].map((propertyName) => {
    const propertyValues = values
      .filter((value) =>
        Object.prototype.hasOwnProperty.call(value, propertyName),
      )
      .map((value) => value[propertyName]);

    const optional = propertyValues.length < values.length;

    const propertyTypes = propertyValues.map((value) =>
      parseValue(value, toTypeName(propertyName), context),
    );

    const uniqueTypes = new Map<string, TypeNode>();

    for (const type of propertyTypes) {
      uniqueTypes.set(typeKey(type), type);
    }

    const types = [...uniqueTypes.values()];

    const propertyType: TypeNode =
      types.length === 1
        ? types[0]
        : {
            kind: "union",
            types,
          };

    return {
      name: propertyName,
      value: propertyType,
      optional,
    };
  });

  const object: ObjectNode = {
    kind: "object",
    name: typeName,
    properties,
  };

  context.registerType(object);

  return object;
}

function typeKey(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return `primitive:${type.type}`;

    case "object":
      return `object:${type.name}`;

    case "array":
      return `array:${typeKey(type.elementType)}`;

    case "union":
      return `union:${type.types.map(typeKey).sort().join("|")}`;
  }
}

function parseObject(
  value: Record<string, unknown>,
  name: string,
  context: TransformationContext,
  parentName?: string,
): ObjectNode {
  const typeName =
    parentName && parentName !== "Root" ? `${parentName}${name}` : name;
  const existing = context.getType(typeName);
  if (existing) {
    return existing;
  }

  const node: ObjectNode = {
    kind: "object",
    name: typeName,
    properties: [],
  };

  context.registerType(node);

  const properties = Object.entries(value).map(
    ([propertyName, propertyValue]) => ({
      name: propertyName,
      value: parseValue(propertyValue, toTypeName(propertyName), context, name),
      optional: false,
    }),
  );

  const completedNode: ObjectNode = {
    ...node,
    properties,
  };

  context.registerType(completedNode);

  return completedNode;
}

function toTypeName(propertyName: string): string {
  return propertyName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
