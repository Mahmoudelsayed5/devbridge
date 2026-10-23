import type {
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
} from "@devbridge/core";

export interface GoOptions extends GeneratorOptions {
  /** Package name. Defaults to `models`. */
  readonly packageName?: string;
  /** Emit `json:"..."` struct tags. Defaults to true. */
  readonly jsonAnnotations?: boolean;
  /** Use a pointer for optional and nullable fields. Defaults to true. */
  readonly pointersForOptional?: boolean;
  /** Name of the single emitted file. Defaults to `models.go`. */
  readonly fileName?: string;
}

const BACKTICK = "`";

function goTypeName(value: string): string {
  return sanitizeIdentifier(toPascalCase(value) || value, {
    fallback: "Type",
  });
}

function primitiveToGo(type: PrimitiveType): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
      return "int";
    case "long":
      return "int64";
    case "number":
      return "float64";
    case "boolean":
      return "bool";
    case "null":
    case "unknown":
      return "any";
  }
}

/** A pointer is pointless for types whose zero value is already nil. */
function isNilable(goType: string): boolean {
  return (
    goType === "any" || goType.startsWith("[]") || goType.startsWith("map[")
  );
}

/**
 * Maps an IR node onto a Go type.
 *
 * A nullable element inside a slice becomes a pointer (`[]*int`), because a
 * Go value type has no way to carry JSON `null`.
 */
export function toGoType(type: TypeNode, usePointers = true): string {
  switch (type.kind) {
    case "primitive":
      return primitiveToGo(type.type);

    case "object":
      return goTypeName(type.name);

    case "array": {
      const { nullable, type: element } = splitNullable(type.elementType);
      const base = toGoType(element, usePointers);
      const pointer = usePointers && nullable && !isNilable(base) ? "*" : "";

      return `[]${pointer}${base}`;
    }

    case "union": {
      const { type: nonNull } = splitNullable(type);

      return nonNull.kind === "union" ? "any" : toGoType(nonNull, usePointers);
    }
  }
}

interface GoField {
  readonly name: string;
  readonly type: string;
  readonly tag: string;
}

function toFields(object: ObjectNode, options: GoOptions): GoField[] {
  const allocator = new NameAllocator();
  const usePointers = options.pointersForOptional ?? true;
  const tags = options.jsonAnnotations ?? true;

  return object.properties.map((property) => {
    const { nullable } = splitNullable(property.value);
    const base = toGoType(property.value, usePointers);
    const optional = property.optional || nullable;

    const type =
      usePointers && optional && !isNilable(base) ? `*${base}` : base;

    const tag = tags
      ? `${BACKTICK}json:"${property.name}${property.optional ? ",omitempty" : ""}"${BACKTICK}`
      : "";

    return {
      name: allocator.allocate(goTypeName(property.name)),
      type,
      tag,
    };
  });
}

/** Pads a column so struct fields line up the way gofmt would. */
function padded(values: readonly string[]): (value: string) => string {
  const width = values.reduce((max, value) => Math.max(max, value.length), 0);

  return (value: string) => value.padEnd(width);
}

function writeStruct(
  object: ObjectNode,
  writer: CodeWriter,
  options: GoOptions,
): void {
  const fields = toFields(object, options);
  const padName = padded(fields.map((field) => field.name));
  const padType = padded(fields.map((field) => field.type));

  writer.block(
    `type ${goTypeName(object.name)} struct {`,
    () => {
      for (const field of fields) {
        const name = padName(field.name);
        const type = field.tag.length > 0 ? padType(field.type) : field.type;
        const tag = field.tag.length > 0 ? ` ${field.tag}` : "";

        writer.line(`${name} ${type}${tag}`.trimEnd());
      }
    },
    "}",
  );
}

export function generateGo(
  root: ObjectNode,
  context: TransformationContext,
  options: GoOptions = {},
): string {
  const objects = context.hasType(root.name)
    ? context.getTypes()
    : [root, ...context.getTypes()];

  const writer = new CodeWriter(options.indent ?? "\t");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER)).blank();
  }

  writer.line(`package ${options.packageName ?? "models"}`).blank();

  objects.forEach((object, index) => {
    if (index > 0) {
      writer.blank();
    }

    writeStruct(object, writer, options);
  });

  return writer.toString();
}

export const goGenerator: TargetGenerator = {
  id: "go",
  irKind: "type-graph",
  label: "Go",
  extension: "go",
  filePerType: false,
  generate(
    root: ObjectNode,
    context: TransformationContext,
    options: GeneratorOptions = {},
  ): GenerateResult {
    const goOptions = options as GoOptions;
    const content = generateGo(root, context, goOptions);

    return {
      files: [{ path: goOptions.fileName ?? "models.go", content }],
      preview: content,
    };
  },
};
