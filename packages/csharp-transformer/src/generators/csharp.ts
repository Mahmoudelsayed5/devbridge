import type {
  Diagnostic,
  EnumNode,
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
  discriminatedUnions,
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
    case "enum":
      return csharpIdentifier(type.name);

    case "map":
      // A JSON object key is always a string, so the key type is fixed.
      return `Dictionary<string, ${toCSharpType(type.valueType)}>`;

    case "literal":
      // C# has no literal types; the tag is a plain string.
      return "string";

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

/**
 * True when the property's own type needs `System.Collections.Generic`.
 *
 * Both `List<T>` and `Dictionary<K, V>` live there, so one using covers
 * either — unlike Java, which imports each by name.
 */
function needsListUsing(type: TypeNode): boolean {
  switch (type.kind) {
    case "array":
    case "map":
      return true;
    case "union":
      return type.types.some(needsListUsing);
    // A referenced class or enum declares its own usings in its own file.
    case "object":
    case "enum":
    case "literal":
    case "primitive":
      return false;
  }
}

function usingsFor(
  objects: readonly ObjectNode[],
  enums: readonly EnumNode[],
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

  // A string enum carries [JsonConverter], which lives in the same using.
  const enumNeedsUsing =
    (options.jsonAnnotations ?? true) &&
    enums.some((node) => node.baseType === "string");

  if (enumNeedsUsing && !usings.includes("using System.Text.Json.Serialization;")) {
    usings.push("using System.Text.Json.Serialization;");
  }

  return usings;
}

/**
 * Values that no C# member name can reproduce on the wire.
 *
 * `JsonStringEnumConverter` serialises the *member name* and parses it back
 * case-insensitively, so a value differing from its name only by casing —
 * `"available"` against `Available`, the overwhelmingly common case — reads
 * correctly and writes in the enum's own casing. A value that is not an
 * identifier at all (`"n/a"`, `"2xx"`, `""`) has no such relationship, and
 * nothing short of .NET 9's `JsonStringEnumMemberName` can express it. Those
 * are reported rather than silently mis-serialised.
 */
function unmappableValues(node: EnumNode): string[] {
  if (node.baseType === "integer") {
    return [];
  }

  return node.members
    .filter(
      (member) =>
        typeof member.value === "string" &&
        member.value.toLowerCase() !== member.name.toLowerCase(),
    )
    .map((member) => String(member.value));
}

function writeEnum(
  node: EnumNode,
  writer: CodeWriter,
  options: CSharpOptions,
): void {
  const annotate = options.jsonAnnotations ?? true;
  const allocator = new NameAllocator([csharpIdentifier(node.name)]);

  // Numeric enums need no converter: System.Text.Json writes the underlying
  // value by default, which is exactly the declared one.
  if (annotate && node.baseType === "string") {
    writer.line("[JsonConverter(typeof(JsonStringEnumConverter))]");
  }

  writer.line(`public enum ${csharpIdentifier(node.name)}`);
  writer.line("{");
  writer.indented(() => {
    node.members.forEach((member, index) => {
      const name = allocator.allocate(csharpIdentifier(member.name));
      const last = index === node.members.length - 1;

      // An integer enum carries its declared value; a string one is
      // positional, its value coming from the converter above.
      const assignment =
        node.baseType === "integer" ? ` = ${member.value}` : "";

      writer.line(`${name}${assignment}${last ? "" : ","}`);
    });
  });
  writer.line("}");
}

/** Warns about enum values C# cannot round-trip. See {@link unmappableValues}. */
function enumDiagnostics(
  enums: readonly EnumNode[],
  options: CSharpOptions,
): Diagnostic[] {
  if ((options.jsonAnnotations ?? true) === false) {
    return [];
  }

  return enums.flatMap((node) => {
    const values = unmappableValues(node);

    if (values.length === 0) {
      return [];
    }

    return [
      {
        severity: "warning" as const,
        code: "csharp/enum-value-unmappable",
        message: `"${node.name}" has ${values.length === 1 ? "a value" : "values"} that C# cannot express as a member name: ${values.map((value) => JSON.stringify(value)).join(", ")}.`,
        hint: "System.Text.Json matches enum member names, so these will not round-trip. .NET 9's JsonStringEnumMemberName, or a hand-written converter, is needed for them.",
      },
    ];
  });
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
  enums: readonly EnumNode[],
  writer: CodeWriter,
  options: CSharpOptions,
): void {
  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  const usings = usingsFor(objects, enums, options);

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
  const enums = context.getEnums();
  const writer = new CodeWriter(options.indent ?? "    ");

  writePreamble(objects, enums, writer, options);

  const declarations = [
    ...enums.map((node) => () => writeEnum(node, writer, options)),
    ...objects.map((object) => () => writeType(object, writer, options)),
  ];

  declarations.forEach((emit, index) => {
    if (index > 0) {
      writer.blank();
    }

    emit();
  });

  return writer.toString();
}

/** One `.cs` file per type, which is the common C# project layout. */
export function generateCSharpFiles(
  root: ObjectNode,
  context: TransformationContext,
  options: CSharpOptions = {},
): Record<string, string> {
  // An enum is a top-level type in C#, so it gets its own file like a class.
  const enumEntries = context.getEnums().map((node): [string, string] => {
    const writer = new CodeWriter(options.indent ?? "    ");

    writePreamble([], [node], writer, options);
    writeEnum(node, writer, options);

    return [`${csharpIdentifier(node.name)}.cs`, writer.toString()];
  });

  const entries = objectsOf(root, context).map((object): [string, string] => {
    const writer = new CodeWriter(options.indent ?? "    ");

    writePreamble([object], [], writer, options);
    writeType(object, writer, options);

    return [`${csharpIdentifier(object.name)}.cs`, writer.toString()];
  });

  return Object.fromEntries([...enumEntries, ...entries]);
}

/**
 * Reports discriminated unions, which C# cannot express.
 *
 * C# would need the branches to share a base type carrying [JsonPolymorphic], which the type graph has no way to express.
 * The union itself is still generated, just without the narrowing — so
 * this says what was lost rather than changing the output.
 */
function discriminatorDiagnostics(
  root: ObjectNode,
  context: TransformationContext,
): Diagnostic[] {
  const all = context.hasType(root.name)
    ? context.getTypes()
    : [root, ...context.getTypes()];

  return discriminatedUnions(all).map((discriminator) => ({
    severity: "warning" as const,
    code: "csharp/discriminator-unsupported",
    message: `The union discriminated by "${discriminator.propertyName}" (${discriminator.mapping
      .map((entry) => entry.value)
      .join(", ")}) is emitted untyped.`,
    hint: "C# would need the branches to share a base type carrying [JsonPolymorphic], which the type graph has no way to express.",
  }));
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

    const diagnostics = [
      ...enumDiagnostics(context.getEnums(), cSharpOptions),
      ...discriminatorDiagnostics(root, context),
    ];

    return {
      files,
      preview: generateCSharp(root, context, cSharpOptions),
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    };
  },
};
