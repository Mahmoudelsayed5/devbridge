import type {
  ObjectNode,
  PrimitiveType,
  TypeNode,
  TransformationContext,
} from "@devbridge/core";

export function generateTypeScript(
  root: ObjectNode,
  context: TransformationContext,
): string {
  const objects = context.getTypes();

  return objects.map(generateObject).join("\n\n");
}

function generateObject(object: ObjectNode): string {
  const properties = object.properties
    .map(
      (property) =>
        ` ${property.name}${property.optional ? "?" : ""}: ${toTypeScriptType(property.value)};`,
    )
    .join("\n");

  return ` interface ${object.name} {\n${properties}\n}`;
}

function toTypeScriptType(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToTypeScript(type.type);

    case "object":
      return type.name;

    case "array":
      const elementType = toTypeScriptType(type.elementType);

      if (type.elementType.kind === "union") {
        return `(${elementType})[]`;
      }
      return `${elementType}[]`;

    case "union":
      return type.types.map(toTypeScriptType).join(" | ");
  }
}

function primitiveToTypeScript(type: PrimitiveType): string {
  switch (type) {
    case "string":
      return "string";

    case "integer":
      return "number";

    case "number":
      return "number";

    case "boolean":
      return "boolean";

    case "null":
      return "null";

    case "unknown":
      return "unknown";
  }
}
