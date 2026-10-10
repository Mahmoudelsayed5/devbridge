import type {
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

export function toTypeScriptType(type: TypeNode): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToTypeScript(type.type);

    case "object":
      return type.name;

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

  objects.forEach((object, index) => {
    if (index > 0) {
      writer.blank();
    }

    declare(object, writer, options);
  });

  return writer.toString().trimEnd() + "\n";
}

export const typeScriptGenerator: TargetGenerator = {
  id: "typescript",
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
