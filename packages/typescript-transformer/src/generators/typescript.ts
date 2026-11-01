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
import { CodeWriter, GENERATED_HEADER, commentBlock } from "@devbridge/core";

export interface TypeScriptOptions extends GeneratorOptions {
  /** Emit `export` on every declaration. Defaults to true. */
  readonly exportTypes?: boolean;
  /** `interface` (default) or `type` aliases. */
  readonly style?: "interface" | "type";
  /** Mark every property `readonly`. Defaults to false. */
  readonly readonlyProperties?: boolean;
  /**
   * `union` (default) emits a union of literal types; `enum` emits a
   * nominal TypeScript enum. See {@link declareEnum}.
   */
  readonly enumStyle?: "union" | "enum";
  /** Name of the single emitted file. Defaults to `types.ts`. */
  readonly fileName?: string;
}

const RESERVED_STYLES = new Set(["interface", "type"]);

/** Property names that need quoting because they are not plain identifiers. */
function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : JSON.stringify(name);
}

function primitiveToTypeScript(type: PrimitiveType): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "long":
    case "number":
      // TypeScript has a single numeric type. A long beyond 2^53 is already
      // imprecise, which the parser warns about separately.
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "unknown":
      return "unknown";
  }
}

export function toTypeScriptType(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToTypeScript(type.type);

    case "object":
    case "enum":
      return type.name;

    case "map":
      return `Record<string, ${toTypeScriptType(type.valueType)}>`;

    case "array": {
      const elementType = toTypeScriptType(type.elementType);

      return type.elementType.kind === "union"
        ? `(${elementType})[]`
        : `${elementType}[]`;
    }

    case "union":
      return type.types.map(toTypeScriptType).join(" | ");
  }
}

/** A wire value as TypeScript source. */
function literal(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Declares an enum.
 *
 * The default is a union of literal types, and that is a deliberate choice
 * rather than a shortcut: it is what a careful TypeScript author writes for a
 * closed set of JSON values. The members *are* the wire values, so no mapping
 * is needed in either direction, it narrows correctly in a `switch`, and it
 * has no runtime footprint. A TypeScript `enum`, by contrast, introduces a
 * runtime object whose members are not the values unless every one is
 * assigned a string explicitly.
 *
 * `enumStyle: "enum"` emits the nominal form for codebases that prefer it.
 */
function declareEnum(
  node: EnumNode,
  writer: CodeWriter,
  options: TypeScriptOptions,
): void {
  const exported = (options.exportTypes ?? true) ? "export " : "";

  if (options.enumStyle === "enum") {
    writer.block(
      `${exported}enum ${node.name} {`,
      () => {
        for (const member of node.members) {
          writer.line(`${member.name} = ${literal(member.value)},`);
        }
      },
      "}",
    );

    return;
  }

  const members = node.members.map((member) => literal(member.value));
  const inline = `${exported}type ${node.name} = ${members.join(" | ")};`;

  // Wrap the way a formatter would once the single line gets unwieldy.
  if (inline.length <= 76) {
    writer.line(inline);

    return;
  }

  writer.line(`${exported}type ${node.name} =`).indented(() => {
    members.forEach((member, index) => {
      writer.line(`| ${member}${index === members.length - 1 ? ";" : ""}`);
    });
  });
}

function declare(
  object: ObjectNode,
  writer: CodeWriter,
  options: TypeScriptOptions,
): void {
  const exported = (options.exportTypes ?? true) ? "export " : "";
  const readonlyPrefix = options.readonlyProperties === true ? "readonly " : "";
  const style = options.style ?? "interface";

  const open =
    style === "type"
      ? `${exported}type ${object.name} = {`
      : `${exported}interface ${object.name} {`;

  writer.block(
    open,
    () => {
      if (object.properties.length === 0) {
        return;
      }

      for (const property of object.properties) {
        const optional = property.optional ? "?" : "";

        writer.line(
          `${readonlyPrefix}${propertyKey(property.name)}${optional}: ${toTypeScriptType(property.value)};`,
        );
      }
    },
    style === "type" ? "};" : "}",
  );
}

/**
 * Generates TypeScript declarations for every type in the context.
 *
 * `root` is accepted for symmetry with the other generators and is emitted
 * first even if it is somehow missing from the context.
 */
export function generateTypeScript(
  root: ObjectNode,
  context: TransformationContext,
  options: TypeScriptOptions = {},
): string {
  if (options.style !== undefined && !RESERVED_STYLES.has(options.style)) {
    throw new Error(
      `Unsupported TypeScript style "${options.style}". Use "interface" or "type".`,
    );
  }

  const objects = context.hasType(root.name)
    ? context.getTypes()
    : [root, ...context.getTypes()];

  const writer = new CodeWriter(options.indent ?? "  ");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  // Enums first: the structures below refer to them, and a reader meeting
  // `status: Status` benefits from having just seen what a Status is.
  const declarations = [
    ...context.getEnums().map((node) => () => declareEnum(node, writer, options)),
    ...objects.map((object) => () => declare(object, writer, options)),
  ];

  declarations.forEach((emit, index) => {
    if (index > 0) {
      writer.blank();
    }

    emit();
  });

  return writer.toString().trimEnd() + "\n";
}

export const typeScriptGenerator: TargetGenerator = {
  id: "typescript",
  irKind: "type-graph",
  label: "TypeScript",
  extension: "ts",
  filePerType: false,
  generate(
    root: ObjectNode,
    context: TransformationContext,
    options: GeneratorOptions = {},
  ): GenerateResult {
    const typeScriptOptions = options as TypeScriptOptions;
    const content = generateTypeScript(root, context, typeScriptOptions);

    return {
      files: [
        { path: typeScriptOptions.fileName ?? "types.ts", content },
      ],
      preview: content,
    };
  },
};
