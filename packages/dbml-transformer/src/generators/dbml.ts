import type {
  GenerateResult,
  GeneratorOptions,
  RelationalGenerator,
  RelationalModel,
  Table,
} from "@devbridge/core";
import {
  CodeWriter,
  GENERATED_HEADER,
  commentBlock,
  isUniqueSet,
  relationshipsOf,
} from "@devbridge/core";

export interface DbmlOptions extends GeneratorOptions {
  /** Emit a `Project` block naming the schema. */
  readonly projectName?: string;
  /** Name of the emitted file. Defaults to `schema.dbml`. */
  readonly fileName?: string;
}

/** DBML identifiers are bare words unless quoted with double quotes. */
function identifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}

/** DBML string settings use single quotes, so embedded ones are doubled. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function columnSettings(table: Table, columnName: string): string[] {
  const column = table.columns.find((candidate) => candidate.name === columnName);

  if (column === undefined) {
    return [];
  }

  const settings: string[] = [];
  const isPrimary = table.primaryKey.some(
    (name) => name.toLowerCase() === column.name.toLowerCase(),
  );

  // A composite primary key is declared in the indexes block instead.
  if (isPrimary && table.primaryKey.length === 1) {
    settings.push("pk");
  }

  if (column.autoIncrement) {
    settings.push("increment");
  }

  if (!column.nullable && !isPrimary) {
    settings.push("not null");
  }

  if (!isPrimary && (column.unique || isUniqueSet(table, [column.name]))) {
    settings.push("unique");
  }

  if (column.defaultValue !== undefined) {
    const value = column.defaultValue.trim();

    // A quoted SQL literal maps onto a DBML string; anything else is an
    // expression and DBML wants those in backticks.
    if (/^'(?:[^']|'')*'$/.test(value)) {
      settings.push(`default: ${quoted(value.slice(1, -1).replace(/''/g, "'"))}`);
    } else if (/^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
      settings.push(`default: ${value}`);
    } else if (/^(true|false|null)$/i.test(value)) {
      settings.push(`default: ${value.toLowerCase()}`);
    } else {
      settings.push(`default: \`${value}\``);
    }
  }

  if (column.comment !== undefined) {
    settings.push(`note: ${quoted(column.comment)}`);
  }

  return settings;
}

function writeTable(table: Table, writer: CodeWriter): void {
  const name =
    table.schema === undefined
      ? identifier(table.name)
      : `${identifier(table.schema)}.${identifier(table.name)}`;

  writer.block(
    `Table ${name} {`,
    () => {
      for (const column of table.columns) {
        const settings = columnSettings(table, column.name);
        const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";

        writer.line(`${identifier(column.name)} ${column.dataType}${suffix}`);
      }

      const composite = table.primaryKey.length > 1;
      const multiColumnUniques = table.uniques.filter(
        (unique) => unique.columns.length > 1,
      );

      if (composite || multiColumnUniques.length > 0) {
        writer.blank();
        writer.block(
          "indexes {",
          () => {
            if (composite) {
              writer.line(
                `(${table.primaryKey.map(identifier).join(", ")}) [pk]`,
              );
            }

            for (const unique of multiColumnUniques) {
              const settings = ["unique"];

              if (unique.name !== undefined) {
                settings.push(`name: ${quoted(unique.name)}`);
              }

              writer.line(
                `(${unique.columns.map(identifier).join(", ")}) [${settings.join(", ")}]`,
              );
            }
          },
          "}",
        );
      }

      if (table.comment !== undefined) {
        writer.blank().line(`Note: ${quoted(table.comment)}`);
      }
    },
    "}",
  );
}

export function generateDbml(
  model: RelationalModel,
  options: DbmlOptions = {},
): string {
  const writer = new CodeWriter(options.indent ?? "  ");

  if (options.header === true) {
    writer.line(commentBlock(GENERATED_HEADER, "//")).blank();
  }

  const projectName = options.projectName ?? options.packageName;

  if (projectName !== undefined && projectName.length > 0) {
    writer
      .block(
        `Project ${identifier(projectName)} {`,
        () => {
          writer.line("database_type: 'SQL'");
        },
        "}",
      )
      .blank();
  }

  model.tables.forEach((table, index) => {
    if (index > 0) {
      writer.blank();
    }

    writeTable(table, writer);
  });

  const relationships = relationshipsOf(model);

  if (relationships.length > 0) {
    writer.blank();

    for (const relationship of relationships) {
      // `>` is many-to-one, `-` is one-to-one; the child side tells us which.
      const operator = relationship.child === "zero-or-one" ? "-" : ">";

      const from = relationship.from
        .map((ref) => `${identifier(ref.table)}.${identifier(ref.column)}`)
        .join(", ");

      const to = relationship.to
        .map((ref) => `${identifier(ref.table)}.${identifier(ref.column)}`)
        .join(", ");

      if (relationship.to.length === 0) {
        continue;
      }

      const left = relationship.from.length > 1 ? `(${from})` : from;
      const right = relationship.to.length > 1 ? `(${to})` : to;

      const settings: string[] = [];

      if (relationship.foreignKey.onDelete !== undefined) {
        settings.push(`delete: ${relationship.foreignKey.onDelete}`);
      }

      if (relationship.foreignKey.onUpdate !== undefined) {
        settings.push(`update: ${relationship.foreignKey.onUpdate}`);
      }

      const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";

      // The colon is part of the inline form in both spellings: an unnamed
      // relationship is `Ref: a.b > c.d`, a named one `Ref name: a.b > c.d`.
      const head =
        relationship.name === undefined
          ? "Ref:"
          : `Ref ${identifier(relationship.name)}:`;

      writer.line(`${head} ${left} ${operator} ${right}${suffix}`);
    }
  }

  return writer.toString();
}

export const dbmlGenerator: RelationalGenerator = {
  id: "dbml",
  irKind: "relational",
  label: "DBML",
  extension: "dbml",
  filePerType: false,
  generate(model: RelationalModel, options: GeneratorOptions = {}): GenerateResult {
    const dbmlOptions = options as DbmlOptions;
    const content = generateDbml(model, dbmlOptions);

    return {
      files: [{ path: dbmlOptions.fileName ?? "schema.dbml", content }],
      preview: content,
    };
  },
};
