import type {
  Cardinality,
  Column,
  GenerateResult,
  GeneratorOptions,
  RelationalGenerator,
  RelationalModel,
  Relationship,
  Table,
} from "@devbridge/core";
import {
  CodeWriter,
  GENERATED_HEADER,
  commentBlock,
  isUniqueSet,
  relationshipsOf,
} from "@devbridge/core";

export interface MermaidOptions extends GeneratorOptions {
  /** Drop type arguments, so `decimal(10,2)` becomes `decimal`. */
  readonly simpleTypes?: boolean;
  /** Include each entity's attribute block. Defaults to true. */
  readonly attributes?: boolean;
  /** Name of the emitted file. Defaults to `erd.mmd`. */
  readonly fileName?: string;
}

/**
 * Mermaid entity names are bare words; anything else has to be quoted.
 */
function entityName(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : JSON.stringify(name);
}

/**
 * Makes a SQL type safe for Mermaid's attribute grammar.
 *
 * Verified against mermaid 11.15: `varchar(255)` and `int[]` parse, but a
 * comma does not — `decimal(10,2)` fails with "Expecting 'ATTRIBUTE_WORD',
 * got ','". A space is equally fatal, because Mermaid splits the attribute
 * line on whitespace and would read `timestamp with time zone` as a type
 * followed by a name. Both become underscores, so the precision survives as
 * `decimal(10_2)` rather than being thrown away.
 */
function attributeType(dataType: string, simple: boolean): string {
  const base = simple ? dataType.replace(/\(.*$/, "") : dataType;
  const cleaned = base
    .trim()
    .replace(/[\s,]+/g, "_")
    .replace(/[^A-Za-z0-9_()[\]]/g, "");

  return cleaned.length === 0 ? "unknown" : cleaned;
}

function attributeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");

  return cleaned.length === 0 ? "column" : cleaned;
}

/**
 * Key markers shown against a column.
 *
 * A comma-separated list is valid (verified against mermaid 11.15), so a
 * column that is both its table's primary key and a foreign key — the usual
 * shape of a one-to-one child — shows `PK, FK` rather than losing one role.
 */
function keyMarker(table: Table, column: Column): string {
  const name = column.name.toLowerCase();
  const markers: string[] = [];

  if (table.primaryKey.some((key) => key.toLowerCase() === name)) {
    markers.push("PK");
  }

  if (
    table.foreignKeys.some((fk) =>
      fk.columns.some((key) => key.toLowerCase() === name),
    )
  ) {
    markers.push("FK");
  }

  if (
    markers.length === 0 &&
    (column.unique || isUniqueSet(table, [column.name]))
  ) {
    markers.push("UK");
  }

  return markers.length === 0 ? "" : ` ${markers.join(", ")}`;
}

/** Mermaid's crow's-foot notation for each side of a relationship. */
function leftMarker(cardinality: Cardinality): string {
  switch (cardinality) {
    case "one":
      return "||";
    case "zero-or-one":
      return "|o";
    case "many":
      return "}|";
    case "zero-or-many":
      return "}o";
  }
}

function rightMarker(cardinality: Cardinality): string {
  switch (cardinality) {
    case "one":
      return "||";
    case "zero-or-one":
      return "o|";
    case "many":
      return "|{";
    case "zero-or-many":
      return "o{";
  }
}

function relationLabel(relationship: Relationship): string {
  if (relationship.name !== undefined && relationship.name.length > 0) {
    return relationship.name;
  }

  const column = relationship.from[0]?.column;

  return column === undefined ? "references" : column;
}

export function generateMermaid(
  model: RelationalModel,
  options: MermaidOptions = {},
): string {
  const writer = new CodeWriter(options.indent ?? "    ");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER, "%%")).blank();
  }

  writer.line("erDiagram");

  writer.indented(() => {
    for (const relationship of relationshipsOf(model)) {
      const left = entityName(relationship.parentTable);
      const right = entityName(relationship.childTable);
      const notation = `${leftMarker(relationship.parent)}--${rightMarker(relationship.child)}`;

      writer.line(
        `${left} ${notation} ${right} : ${JSON.stringify(relationLabel(relationship))}`,
      );
    }

    if (options.attributes === false) {
      // Entities still need declaring when no attributes are drawn.
      for (const table of model.tables) {
        writer.line(`${entityName(table.name)} {`).line("}");
      }

      return;
    }

    for (const table of model.tables) {
      writer.block(
        `${entityName(table.name)} {`,
        () => {
          for (const column of table.columns) {
            const type = attributeType(column.dataType, options.simpleTypes === true);

            writer.line(
              `${type} ${attributeName(column.name)}${keyMarker(table, column)}`,
            );
          }
        },
        "}",
      );
    }
  });

  return writer.toString();
}

export const mermaidGenerator: RelationalGenerator = {
  id: "mermaid",
  irKind: "relational",
  label: "Mermaid ERD",
  extension: "mmd",
  filePerType: false,
  generate(model: RelationalModel, options: GeneratorOptions = {}): GenerateResult {
    const mermaidOptions = options as MermaidOptions;
    const content = generateMermaid(model, mermaidOptions);

    return {
      files: [{ path: mermaidOptions.fileName ?? "erd.mmd", content }],
      preview: content,
    };
  },
};
