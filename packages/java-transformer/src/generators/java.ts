import type {
  EnumNode,
  GenerateResult,
  GeneratedFile,
  GeneratorOptions,
  ObjectNode,
  ObjectProperty,
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
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from "@devbridge/core";

export type JavaFiles = Record<string, string>;

export interface JavaOptions extends GeneratorOptions {
  /** Package declaration, for example `com.example.model`. Omitted when unset. */
  readonly packageName?: string;
  /** `class` (default) emits mutable POJOs, `record` emits Java records. */
  readonly style?: "class" | "record";
  /** Generate getters and setters for `class` style. Defaults to true. */
  readonly accessors?: boolean;
  /** Emit `@JsonProperty` when a field name differs from the JSON key. */
  readonly jsonAnnotations?: boolean;
}

const JAVA_KEYWORDS: ReadonlySet<string> = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while",
  "true", "false", "null",
  // Contextual keywords, reserved defensively.
  "var", "record", "sealed", "permits", "yield",
]);

function javaClassName(value: string): string {
  return sanitizeIdentifier(toPascalCase(value) || value, {
    keywords: JAVA_KEYWORDS,
    fallback: "Type",
  });
}

function javaFieldName(value: string): string {
  return sanitizeIdentifier(toCamelCase(value) || value, {
    keywords: JAVA_KEYWORDS,
    fallback: "value",
  });
}

function primitiveToJava(type: PrimitiveType, boxed: boolean): string {
  switch (type) {
    case "string":
      return "String";
    case "integer":
      return boxed ? "Integer" : "int";
    case "long":
      return boxed ? "Long" : "long";
    case "number":
      return boxed ? "Double" : "double";
    case "boolean":
      return boxed ? "Boolean" : "boolean";
    case "null":
    case "unknown":
      return "Object";
  }
}

/**
 * Maps an IR node onto a Java type.
 *
 * `boxed` forces a wrapper type. A field is boxed when it is optional or
 * nullable, because a Java primitive cannot represent "absent".
 */
export function toJavaType(type: TypeNode, boxed = false): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToJava(type.type, boxed);

    case "object":
    case "enum":
      return javaClassName(type.name);

    case "array":
      // Generics cannot hold primitives, so elements are always boxed.
      return `List<${toJavaType(type.elementType, true)}>`;

    case "union": {
      const { type: nonNull } = splitNullable(type);

      return nonNull.kind === "union" ? "Object" : toJavaType(nonNull, true);
    }
  }
}

/** True when the property's own type needs `java.util.List`. */
function needsListImport(type: TypeNode): boolean {
  switch (type.kind) {
    case "array":
      return true;
    case "union":
      return type.types.some(needsListImport);
    // A referenced class or enum declares its own imports in its own file.
    case "object":
    case "enum":
    case "primitive":
      return false;
  }
}

interface JavaField {
  readonly jsonName: string;
  readonly name: string;
  readonly type: string;
  readonly accessorSuffix: string;
}

function toFields(object: ObjectNode): JavaField[] {
  const allocator = new NameAllocator([javaClassName(object.name)]);

  return object.properties.map((property: ObjectProperty) => {
    const { nullable } = splitNullable(property.value);
    const name = allocator.allocate(javaFieldName(property.name));

    return {
      jsonName: property.name,
      name,
      type: toJavaType(property.value, property.optional || nullable),
      accessorSuffix: name.charAt(0).toUpperCase() + name.slice(1),
    };
  });
}

function writeClass(
  object: ObjectNode,
  writer: CodeWriter,
  options: JavaOptions,
  isPublic: boolean,
): void {
  const fields = toFields(object);
  const modifier = isPublic ? "public " : "";
  const className = javaClassName(object.name);
  const annotate = options.jsonAnnotations === true;

  if ((options.style ?? "class") === "record") {
    const components = fields
      .map((field) => `${field.type} ${field.name}`)
      .join(", ");

    writer.line(`${modifier}record ${className}(${components}) {`).line("}");

    return;
  }

  writer.block(
    `${modifier}class ${className} {`,
    () => {
      writer.blank();

      for (const field of fields) {
        if (annotate && field.name !== field.jsonName) {
          writer.line(`@JsonProperty(${JSON.stringify(field.jsonName)})`);
        }

        writer.line(`private ${field.type} ${field.name};`);
      }

      writer.blank();

      if (options.accessors ?? true) {
        for (const field of fields) {
          writer
            .block(
              `public ${field.type} get${field.accessorSuffix}() {`,
              () => {
                writer.line(`return this.${field.name};`);
              },
              "}",
            )
            .blank()
            .block(
              `public void set${field.accessorSuffix}(${field.type} ${field.name}) {`,
              () => {
                writer.line(`this.${field.name} = ${field.name};`);
              },
              "}",
            )
            .blank();
        }
      }
    },
    "}",
  );
}

/** A wire value as Java source. */
function literal(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** `available` -> `AVAILABLE`, which is how Java spells a constant. */
function javaConstantName(value: string): string {
  return sanitizeIdentifier(toSnakeCase(value).toUpperCase(), {
    fallback: "VALUE",
    keywords: JAVA_KEYWORDS,
  });
}

/**
 * Writes a Java enum that remembers the value it came from.
 *
 * A bare `enum Status { AVAILABLE }` loses information: Java constants are
 * `SHOUTY_CASE` and the wire value is usually not, so the mapping back to
 * `"available"` would exist nowhere. Each constant therefore carries its
 * value, with a `getValue()` to read it and a `fromValue` to parse one —
 * which is what a careful Java author writes for exactly this reason, and
 * what Jackson's `@JsonValue` / `@JsonCreator` hook onto when annotations are
 * switched on.
 */
function writeEnum(
  node: EnumNode,
  writer: CodeWriter,
  options: JavaOptions,
  isPublic: boolean,
): void {
  const annotate = options.jsonAnnotations === true;
  const valueType = node.baseType === "integer" ? "int" : "String";
  const name = javaClassName(node.name);

  writer.block(
    `${isPublic ? "public " : ""}enum ${name} {`,
    () => {
      node.members.forEach((member, index) => {
        const last = index === node.members.length - 1;

        writer.line(
          `${javaConstantName(member.name)}(${literal(member.value)})${last ? ";" : ","}`,
        );
      });

      writer.blank();
      writer.line(`private final ${valueType} value;`).blank();

      writer.block(
        `${name}(${valueType} value) {`,
        () => {
          writer.line("this.value = value;");
        },
        "}",
      );

      writer.blank();

      if (annotate) {
        writer.line("@JsonValue");
      }

      writer.block(
        `public ${valueType} getValue() {`,
        () => {
          writer.line("return this.value;");
        },
        "}",
      );

      writer.blank();

      if (annotate) {
        writer.line("@JsonCreator");
      }

      writer.block(
        `public static ${name} fromValue(${valueType} value) {`,
        () => {
          writer.block(
            `for (${name} candidate : values()) {`,
            () => {
              // `==` is right for int and wrong for String, so compare the
              // way each type requires rather than the way that reads shorter.
              const matches =
                node.baseType === "integer"
                  ? "candidate.value == value"
                  : "candidate.value.equals(value)";

              writer.block(
                `if (${matches}) {`,
                () => {
                  writer.line("return candidate;");
                },
                "}",
              );
            },
            "}",
          );

          writer.blank();
          writer.line(
            `throw new IllegalArgumentException("Unknown ${name}: " + value);`,
          );
        },
        "}",
      );
    },
    "}",
  );
}

function objectsOf(
  root: ObjectNode,
  context: TransformationContext,
): ObjectNode[] {
  const objects = context.hasType(root.name)
    ? [...context.getTypes()]
    : [root, ...context.getTypes()];

  const seen = new Set<string>();

  return objects.filter((object) => {
    if (seen.has(object.name)) {
      return false;
    }

    seen.add(object.name);

    return true;
  });
}

/** The package clause and Jackson imports for a standalone enum file. */
function enumFileHeader(options: JavaOptions, writer: CodeWriter): void {
  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  if (options.packageName !== undefined && options.packageName.length > 0) {
    writer.line(`package ${options.packageName};`).blank();
  }

  if (options.jsonAnnotations === true) {
    writer
      .linesOf([
        "import com.fasterxml.jackson.annotation.JsonCreator;",
        "import com.fasterxml.jackson.annotation.JsonValue;",
      ])
      .blank();
  }
}

function fileHeader(
  object: ObjectNode,
  options: JavaOptions,
  writer: CodeWriter,
): void {
  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  if (options.packageName !== undefined && options.packageName.length > 0) {
    writer.line(`package ${options.packageName};`).blank();
  }

  const imports: string[] = [];

  if (object.properties.some((property) => needsListImport(property.value))) {
    imports.push("import java.util.List;");
  }

  if (
    options.jsonAnnotations === true &&
    object.properties.some(
      (property) => javaFieldName(property.name) !== property.name,
    )
  ) {
    imports.push("import com.fasterxml.jackson.annotation.JsonProperty;");
  }

  if (imports.length > 0) {
    writer.linesOf(imports).blank();
  }
}

/**
 * Generates one Java source file per object type.
 * Each returned key is a filename, and each value is its source code.
 */
export function generateJavaFiles(
  root: ObjectNode,
  context: TransformationContext,
  options: JavaOptions = {},
): JavaFiles {
  // An enum is a top-level type in Java, so it gets its own file like a class.
  const enumEntries = context.getEnums().map((node): [string, string] => {
    const writer = new CodeWriter(options.indent ?? "    ");

    enumFileHeader(options, writer);
    writeEnum(node, writer, options, true);

    return [`${javaClassName(node.name)}.java`, writer.toString()];
  });

  const entries = objectsOf(root, context).map((object): [string, string] => {
    const writer = new CodeWriter(options.indent ?? "    ");

    fileHeader(object, options, writer);
    writeClass(object, writer, options, true);

    return [`${javaClassName(object.name)}.java`, writer.toString()];
  });

  return Object.fromEntries([...enumEntries, ...entries]);
}

/**
 * Generates a single-document preview containing every class.
 *
 * Only the root class is public, because Java allows at most one public type
 * per file. Use {@link generateJavaFiles} for compilable output.
 */
export function generateJava(
  root: ObjectNode,
  context: TransformationContext,
  options: JavaOptions = {},
): string {
  const objects = objectsOf(root, context);
  const writer = new CodeWriter(options.indent ?? "    ");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  if (options.packageName !== undefined && options.packageName.length > 0) {
    writer.line(`package ${options.packageName};`).blank();
  }

  const imports: string[] = [];

  const anyList = objects.some((object) =>
    object.properties.some((property) => needsListImport(property.value)),
  );

  if (anyList) {
    imports.push("import java.util.List;");
  }

  if (
    options.jsonAnnotations === true &&
    objects.some((object) =>
      object.properties.some(
        (property) => javaFieldName(property.name) !== property.name,
      ),
    )
  ) {
    imports.push("import com.fasterxml.jackson.annotation.JsonProperty;");
  }

  const enums = context.getEnums();

  if (options.jsonAnnotations === true && enums.length > 0) {
    imports.push("import com.fasterxml.jackson.annotation.JsonCreator;");
    imports.push("import com.fasterxml.jackson.annotation.JsonValue;");
  }

  if (imports.length > 0) {
    writer.linesOf([...imports].sort()).blank();
  }

  // Enums first, then classes. Only the first declaration may be public,
  // which is why this preview is a preview: see generateJavaFiles.
  const declarations = [
    ...enums.map((node) => (isPublic: boolean) => writeEnum(node, writer, options, isPublic)),
    ...objects.map((object) => (isPublic: boolean) => writeClass(object, writer, options, isPublic)),
  ];

  declarations.forEach((emit, index) => {
    if (index > 0) {
      writer.blank();
    }

    emit(index === 0);
  });

  return writer.toString();
}

export const javaGenerator: TargetGenerator = {
  id: "java",
  irKind: "type-graph",
  label: "Java",
  extension: "java",
  filePerType: true,
  generate(
    root: ObjectNode,
    context: TransformationContext,
    options: GeneratorOptions = {},
  ): GenerateResult {
    const javaOptions = options as JavaOptions;

    const files: GeneratedFile[] = Object.entries(
      generateJavaFiles(root, context, javaOptions),
    ).map(([path, content]) => ({ path, content }));

    return {
      files,
      preview: generateJava(root, context, javaOptions),
    };
  },
};
