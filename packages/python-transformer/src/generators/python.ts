import type {
  EnumNode,
  GenerateResult,
  GeneratorOptions,
  ObjectNode,
  PrimitiveType,
  TargetGenerator,
  TransformationContext,
  TypeNode,
} from "@devbridge/core";
import {
  CodeWriter,
  GENERATED_HEADER,
  NameAllocator,
  commentBlock,
  sanitizeIdentifier,
  splitNullable,
  toPascalCase,
  toSnakeCase,
} from "@devbridge/core";

export interface PythonOptions extends GeneratorOptions {
  /**
   * How to derive attribute names.
   * - `preserve` (default): keep the JSON key so `Root(**payload)` works.
   * - `snake_case`: rename to the Python convention.
   */
  readonly fieldStyle?: "preserve" | "snake_case";
  /** Name of the single emitted file. Defaults to `models.py`. */
  readonly fileName?: string;
}

const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  "match", "case",
]);

function pythonClassName(value: string): string {
  return sanitizeIdentifier(toPascalCase(value) || value, {
    keywords: PYTHON_KEYWORDS,
    fallback: "Type",
  });
}

function pythonFieldName(value: string, options: PythonOptions): string {
  const base =
    (options.fieldStyle ?? "preserve") === "snake_case"
      ? toSnakeCase(value)
      : value;

  return sanitizeIdentifier(base || value, {
    keywords: PYTHON_KEYWORDS,
    fallback: "value",
  });
}

function primitiveToPython(type: PrimitiveType): string {
  switch (type) {
    case "string":
      return "str";
    case "integer":
    case "long":
      // Python integers are arbitrary precision, so one type covers both.
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "null":
      return "None";
    case "unknown":
      return "Any";
  }
}

/** Collects the `typing` names an annotation needs. */
function collectImports(type: TypeNode, into: Set<string>): void {
  switch (type.kind) {
    case "primitive":
      if (type.type === "unknown") {
        into.add("Any");
      }

      return;

    case "object":
    case "enum":
      return;

    case "array":
      collectImports(type.elementType, into);

      return;

    case "map":
      collectImports(type.valueType, into);

      return;

    case "union": {
      const { nullable, type: nonNull } = splitNullable(type);

      if (nullable) {
        into.add("Optional");
      }

      if (nonNull.kind === "union") {
        into.add("Union");

        for (const member of nonNull.types) {
          collectImports(member, into);
        }

        return;
      }

      collectImports(nonNull, into);

      return;
    }
  }
}

export function toPythonType(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToPython(type.type);

    case "object":
    case "enum":
      return pythonClassName(type.name);

    case "map":
      return `dict[str, ${toPythonType(type.valueType)}]`;

    case "array":
      return `list[${toPythonType(type.elementType)}]`;

    case "union": {
      const { nullable, type: nonNull } = splitNullable(type);

      const inner =
        nonNull.kind === "union"
          ? `Union[${nonNull.types.map(toPythonType).join(", ")}]`
          : toPythonType(nonNull);

      return nullable ? `Optional[${inner}]` : inner;
    }
  }
}

interface PythonField {
  readonly name: string;
  readonly annotation: string;
  readonly hasDefault: boolean;
}

function toFields(object: ObjectNode, options: PythonOptions): PythonField[] {
  const allocator = new NameAllocator();

  const fields = object.properties.map((property): PythonField => {
    const { nullable } = splitNullable(property.value);
    const annotation = toPythonType(property.value);

    return {
      name: allocator.allocate(pythonFieldName(property.name, options)),
      annotation:
        property.optional && !nullable
          ? `Optional[${annotation}]`
          : annotation,
      hasDefault: property.optional,
    };
  });

  // Python forbids a field without a default after one that has a default.
  return [
    ...fields.filter((field) => !field.hasDefault),
    ...fields.filter((field) => field.hasDefault),
  ];
}

/**
 * Writes a Python enum.
 *
 * It subclasses `str` (or `int`) as well as `Enum` deliberately: a plain
 * `Enum` member is not equal to its value and `json.dumps` refuses to
 * serialise it, whereas `class Status(str, Enum)` *is* a string everywhere it
 * matters, so existing code comparing to `"available"` keeps working and the
 * value round-trips without a custom encoder.
 */
function writeEnum(node: EnumNode, writer: CodeWriter): void {
  const base = node.baseType === "integer" ? "int" : "str";
  const allocator = new NameAllocator();

  writer.line(`class ${pythonClassName(node.name)}(${base}, Enum):`).indented(
    () => {
      for (const member of node.members) {
        const name = allocator.allocate(
          sanitizeIdentifier(toSnakeCase(member.name).toUpperCase(), {
            keywords: PYTHON_KEYWORDS,
            fallback: "VALUE",
          }),
        );

        const literal =
          typeof member.value === "string"
            ? JSON.stringify(member.value)
            : String(member.value);

        writer.line(`${name} = ${literal}`);
      }
    },
  );
}

function writeClass(
  object: ObjectNode,
  writer: CodeWriter,
  options: PythonOptions,
): void {
  const fields = toFields(object, options);

  writer.line("@dataclass");
  writer.line(`class ${pythonClassName(object.name)}:`);
  writer.indented(() => {
    if (fields.length === 0) {
      writer.line("pass");

      return;
    }

    for (const field of fields) {
      writer.line(
        `${field.name}: ${field.annotation}${field.hasDefault ? " = None" : ""}`,
      );
    }
  });
}

export function generatePython(
  root: ObjectNode,
  context: TransformationContext,
  options: PythonOptions = {},
): string {
  const objects = context.hasType(root.name)
    ? context.getTypes()
    : [root, ...context.getTypes()];

  const typingImports = new Set<string>();

  for (const object of objects) {
    for (const property of object.properties) {
      collectImports(property.value, typingImports);

      if (property.optional) {
        typingImports.add("Optional");
      }
    }
  }

  const writer = new CodeWriter(options.indent ?? "    ");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER, "#")).blank();
  }

  // Postponed evaluation lets a class reference a type defined further down.
  writer.line("from __future__ import annotations").blank();
  writer.line("from dataclasses import dataclass");

  const enums = context.getEnums();

  if (enums.length > 0) {
    writer.line("from enum import Enum");
  }

  if (typingImports.size > 0) {
    writer.line(`from typing import ${[...typingImports].sort().join(", ")}`);
  }

  // PEP 8 asks for two blank lines between top-level definitions.
  for (const node of enums) {
    writer.line("").line("");
    writeEnum(node, writer);
  }

  for (const object of objects) {
    writer.line("").line("");
    writeClass(object, writer, options);
  }

  return writer.toString();
}

export const pythonGenerator: TargetGenerator = {
  id: "python",
  irKind: "type-graph",
  label: "Python",
  extension: "py",
  filePerType: false,
  generate(
    root: ObjectNode,
    context: TransformationContext,
    options: GeneratorOptions = {},
  ): GenerateResult {
    const pythonOptions = options as PythonOptions;
    const content = generatePython(root, context, pythonOptions);

    return {
      files: [{ path: pythonOptions.fileName ?? "models.py", content }],
      preview: content,
    };
  },
};
