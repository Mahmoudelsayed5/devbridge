import type {
  GenerateResult,
  GeneratedFile,
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
} from "@devbridge/core";

export interface CSharpOptions extends GeneratorOptions {
  /** Namespace for the generated types. Omitted when unset. */
  readonly packageName?: string;
  /** `class` (default) or positional `record`. */
  readonly style?: "class" | "record";
  /** Emit `[JsonPropertyName]` when a property name differs. Defaults to true. */
  readonly jsonAnnotations?: boolean;
  /**
   * Mark non-optional properties `required` (C# 11+). Defaults to true; turn
   * it off to target an older language version, which then relies on
   * nullable reference types instead.
   */
  readonly useRequired?: boolean;
}

const CSHARP_KEYWORDS: ReadonlySet<string> = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char",
  "checked", "class", "const", "continue", "decimal", "default", "delegate",
  "do", "double", "else", "enum", "event", "explicit", "extern", "false",
  "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit",
  "in", "int", "interface", "internal", "is", "lock", "long", "namespace",
  "new", "null", "object", "operator", "out", "override", "params",
  "private", "protected", "public", "readonly", "ref", "return", "sbyte",
  "sealed", "short", "sizeof", "stackalloc", "static", "string", "struct",
  "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong",
  "unchecked", "unsafe", "ushort", "using", "virtual", "void", "volatile",
  "while",
]);

/** Reserved words are escaped with `@`, which is legal C#. */
function csharpIdentifier(value: string): string {
  const identifier = sanitizeIdentifier(toPascalCase(value) || value, {
    fallback: "Value",
  });

  return CSHARP_KEYWORDS.has(identifier) ? `@${identifier}` : identifier;
}

function primitiveToCSharp(type: PrimitiveType): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
      return "int";
    case "long":
      return "long";
    case "number":
      return "double";
    case "boolean":
      return "bool";
    case "null":
    case "unknown":
      return "object";
  }
}

export function toCSharpType(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToCSharp(type.type);

    case "object":
      return csharpIdentifier(type.name);

    case "array": {
      const { nullable, type: element } = splitNullable(type.elementType);
      const base = toCSharpType(element);

      // `int?` for a nullable value type, `string?` under nullable reference
      // types: both are written the same way.
      return `List<${base}${nullable ? "?" : ""}>`;
    }

    case "union": {
      const { type: nonNull } = splitNullable(type);

      return nonNull.kind === "union" ? "object" : toCSharpType(nonNull);
    }
  }
}

interface CSharpProperty {
  readonly jsonName: string;
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

function toProperties(object: ObjectNode): CSharpProperty[] {
  const allocator = new NameAllocator([csharpIdentifier(object.name)]);

  return object.properties.map((property) => {
    const { nullable } = splitNullable(property.value);
    const optional = property.optional || nullable;
    const base = toCSharpType(property.value);

    return {
      jsonName: property.name,
      name: allocator.allocate(csharpIdentifier(property.name)),
      type: optional && !base.endsWith("?") ? `${base}?` : base,
      required: !optional,
    };
  });
}

/** True when the property's own type needs `System.Collections.Generic`. */
function needsListUsing(type: TypeNode): boolean {
  switch (type.kind) {
    case "array":
      return true;
    case "union":
      return type.types.some(needsListUsing);
    // A referenced class declares its own usings in its own file.
    case "object":
    case "primitive":
      return false;
  }
}

function usingsFor(
  objects: readonly ObjectNode[],
  options: CSharpOptions,
): string[] {
  const usings: string[] = [];

  const usesList = objects.some((object) =>
    object.properties.some((property) => needsListUsing(property.value)),
  );

  if (usesList) {
    usings.push("using System.Collections.Generic;");
  }

  if (
    (options.jsonAnnotations ?? true) &&
    objects.some((object) =>
      object.properties.some(
        (property) => csharpIdentifier(property.name) !== property.name,
      ),
    )
  ) {
    usings.push("using System.Text.Json.Serialization;");
  }

  return usings;
}

function writeType(
  object: ObjectNode,
  writer: CodeWriter,
  options: CSharpOptions,
): void {
  const properties = toProperties(object);
  const annotate = options.jsonAnnotations ?? true;
  const useRequired = options.useRequired ?? true;
  const name = csharpIdentifier(object.name);

  if ((options.style ?? "class") === "record") {
    const components = properties
      .map((property) => `${property.type} ${property.name}`)
      .join(", ");

    writer.line(`public record ${name}(${components});`);

    return;
  }

  // Allman braces, which is the dominant C# style.
  writer.line(`public class ${name}`);
  writer.line("{");
  writer.indented(() => {
    properties.forEach((property, index) => {
      if (index > 0) {
        writer.blank();
      }

      if (annotate && property.name !== property.jsonName) {
        writer.line(`[JsonPropertyName(${JSON.stringify(property.jsonName)})]`);
      }

      const modifier = useRequired && property.required ? "required " : "";

      writer.line(
        `public ${modifier}${property.type} ${property.name} { get; set; }`,
      );
    });
  });
  writer.line("}");
}

function objectsOf(
  root: ObjectNode,
  context: TransformationContext,
): readonly ObjectNode[] {
  return context.hasType(root.name)
    ? context.getTypes()
    : [root, ...context.getTypes()];
}

function writePreamble(
  objects: readonly ObjectNode[],
  writer: CodeWriter,
  options: CSharpOptions,
): void {
  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  const usings = usingsFor(objects, options);

  if (usings.length > 0) {
    writer.linesOf(usings).blank();
  }

  if (options.packageName !== undefined && options.packageName.length > 0) {
    writer.line(`namespace ${options.packageName};`).blank();
  }
}

export function generateCSharp(
  root: ObjectNode,
  context: TransformationContext,
  options: CSharpOptions = {},
): string {
  const objects = objectsOf(root, context);
  const writer = new CodeWriter(options.indent ?? "    ");

  writePreamble(objects, writer, options);

  objects.forEach((object, index) => {
    if (index > 0) {
      writer.blank();
    }

    writeType(object, writer, options);
  });

  return writer.toString();
}

/** One `.cs` file per type, which is the common C# project layout. */
export function generateCSharpFiles(
  root: ObjectNode,
  context: TransformationContext,
  options: CSharpOptions = {},
): Record<string, string> {
  const entries = objectsOf(root, context).map((object): [string, string] => {
    const writer = new CodeWriter(options.indent ?? "    ");

    writePreamble([object], writer, options);
    writeType(object, writer, options);

    return [`${csharpIdentifier(object.name)}.cs`, writer.toString()];
  });

  return Object.fromEntries(entries);
}

export const cSharpGenerator: TargetGenerator = {
  id: "csharp",
  irKind: "type-graph",
  label: "C#",
  extension: "cs",
  filePerType: true,
  generate(
    root: ObjectNode,
    context: TransformationContext,
    options: GeneratorOptions = {},
  ): GenerateResult {
    const cSharpOptions = options as CSharpOptions;

    const files: GeneratedFile[] = Object.entries(
      generateCSharpFiles(root, context, cSharpOptions),
    ).map(([path, content]) => ({ path, content }));

    return {
      files,
      preview: generateCSharp(root, context, cSharpOptions),
    };
  },
};
