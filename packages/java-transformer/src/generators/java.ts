import type {
  ObjectNode,
  PrimitiveType,
  TransformationContext,
  TypeNode,
} from "@devbridge/core";

export type JavaFiles = Record<string, string>;

function getObjects(
  root: ObjectNode,
  context: TransformationContext,
): ObjectNode[] {
  const objects = [root, ...context.getTypes()];

  // Keep one declaration per class name.
  return objects.filter(
    (object, index) =>
      objects.findIndex((candidate) => candidate.name === object.name) ===
      index,
  );
}

/**
 * Generates one Java source file per object type.
 * Each returned key is a filename, and each value is its source code.
 */
export function generateJavaFiles(
  root: ObjectNode,
  context: TransformationContext,
): JavaFiles {
  const objects = getObjects(root, context);

  return Object.fromEntries(
    objects.map((object) => {
      const body = generateClass(object, true);
      const needsListImport = object.properties.some((property) =>
        containsArray(property.value),
      );

      const imports = needsListImport ? "import java.util.List;\n\n" : "";

      return [`${object.name}.java`, imports + body];
    }),
  );
}

/**
 * Generates a combined preview for compatibility with the existing API.
 * Use generateJavaFiles() when actual Java source files are needed.
 */
export function generateJava(
  root: ObjectNode,
  context: TransformationContext,
): string {
  const objects = getObjects(root, context);

  const needsListImport = objects.some((object) =>
    object.properties.some((property) => containsArray(property.value)),
  );

  const imports = needsListImport ? "import java.util.List;\n\n" : "";

  return (
    imports +
    objects
      .map((object, index) => generateClass(object, index === 0))
      .join("\n\n")
  );
}

function generateClass(object: ObjectNode, isPublic: boolean): string {
  const fields = object.properties
    .map((property) => {
      const type = toJavaType(property.value, property.optional);
      const name = toJavaIdentifier(property.name);

      return `    private ${type} ${name};`;
    })
    .join("\n");

  const modifier = isPublic ? "public " : "";

  return `${modifier}class ${toJavaIdentifier(object.name)} {\n\n${fields}\n\n}`;
}

function toJavaType(type: TypeNode, boxed = false): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToJava(type.type, boxed);

    case "object":
      return toJavaIdentifier(type.name);

    case "array":
      return `List<${toJavaType(type.elementType, true)}>`;

    case "union": {
      const nonNullTypes = type.types.filter(
        (item) => !(item.kind === "primitive" && item.type === "null"),
      );

      if (nonNullTypes.length === 1) {
        return toJavaType(nonNullTypes[0], true);
      }

      return "Object";
    }
  }
}

function primitiveToJava(type: PrimitiveType, boxed: boolean): string {
  switch (type) {
    case "string":
      return "String";

    case "integer":
      return boxed ? "Integer" : "int";

    case "number":
      return boxed ? "Double" : "double";

    case "boolean":
      return boxed ? "Boolean" : "boolean";

    case "null":
    case "unknown":
      return "Object";
  }
}

function containsArray(type: TypeNode): boolean {
  switch (type.kind) {
    case "array":
      return true;

    case "object":
      return type.properties.some((property) => containsArray(property.value));

    case "union":
      return type.types.some(containsArray);

    case "primitive":
      return false;
  }
}

function toJavaIdentifier(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_$]/g, "_");

  const validStart = /^[a-zA-Z_$]/.test(sanitized)
    ? sanitized
    : `_${sanitized}`;

  const javaKeywords = new Set([
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "try",
    "void",
    "volatile",
    "while",
    "true",
    "false",
    "null",
    "var",
    "record",
    "sealed",
    "permits",
    "yield",
  ]);

  return javaKeywords.has(validStart) ? `${validStart}_` : validStart;
}
