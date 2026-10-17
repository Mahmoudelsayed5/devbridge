/**
 * The relational intermediate representation.
 *
 * This is DevBridge's second IR, and the reason it exists is foreign keys.
 * The type-graph IR in `../ir` models the *shape* of a value — primitives,
 * objects, arrays, unions — which is exactly right for JSON and for
 * generating language models from it. A database schema instead models
 * tables, keys and the relationships between them, and an ERD or a DBML file
 * is mostly a rendering of those relationships. There is nowhere in
 * `TypeNode` to put "this column references that table's primary key", so a
 * SQL schema squeezed into it would lose the information its targets need.
 *
 * Both IRs share everything else: naming, diagnostics, the code writer and
 * the registries.
 */

export interface ColumnRef {
  readonly table: string;
  readonly column: string;
}

export interface Column {
  readonly name: string;
  /** Type as written, normalised for case: `varchar(255)`, `int`. */
  readonly dataType: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly autoIncrement: boolean;
  /** Default expression exactly as written, or undefined when none. */
  readonly defaultValue?: string;
  readonly comment?: string;
}

export type ReferentialAction =
  | "cascade"
  | "restrict"
  | "set null"
  | "set default"
  | "no action";

export interface ForeignKey {
  readonly name?: string;
  /** Columns on *this* table. */
  readonly columns: readonly string[];
  readonly referencesTable: string;
  /** Columns on the referenced table; empty means its primary key. */
  readonly referencesColumns: readonly string[];
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export interface UniqueConstraint {
  readonly name?: string;
  readonly columns: readonly string[];
}

export interface Table {
  readonly name: string;
  readonly schema?: string;
  readonly columns: readonly Column[];
  /** Primary key column names, in key order. Empty when the table has none. */
  readonly primaryKey: readonly string[];
  readonly uniques: readonly UniqueConstraint[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly comment?: string;
}

export interface RelationalModel {
  readonly tables: readonly Table[];
}

/** How many rows on each side of a relationship. */
export type Cardinality = "one" | "zero-or-one" | "many" | "zero-or-many";

export interface Relationship {
  readonly from: ColumnRef[];
  readonly to: ColumnRef[];
  /** Rows on the referenced (parent) side. */
  readonly parent: Cardinality;
  /** Rows on the referencing (child) side. */
  readonly child: Cardinality;
  readonly name?: string;
  readonly foreignKey: ForeignKey;
  readonly childTable: string;
  readonly parentTable: string;
}

export function findTable(
  model: RelationalModel,
  name: string,
): Table | undefined {
  const wanted = name.toLowerCase();

  return model.tables.find((table) => table.name.toLowerCase() === wanted);
}

export function findColumn(table: Table, name: string): Column | undefined {
  const wanted = name.toLowerCase();

  return table.columns.find((column) => column.name.toLowerCase() === wanted);
}

/** True when `columns` are collectively unique on `table`. */
export function isUniqueSet(
  table: Table,
  columns: readonly string[],
): boolean {
  const wanted = columns.map((column) => column.toLowerCase()).sort();
  const same = (candidate: readonly string[]): boolean => {
    const other = candidate.map((column) => column.toLowerCase()).sort();

    return (
      other.length === wanted.length &&
      other.every((column, index) => column === wanted[index])
    );
  };

  if (same(table.primaryKey)) {
    return true;
  }

  if (table.uniques.some((unique) => same(unique.columns))) {
    return true;
  }

  // A single column marked UNIQUE inline.
  if (columns.length === 1) {
    const column = findColumn(table, columns[0] as string);

    return column?.unique === true || column?.primaryKey === true;
  }

  return false;
}

/**
 * Derives relationships from every foreign key in the model.
 *
 * Cardinality is read off the schema rather than guessed: a nullable child
 * column means the parent side is optional, and a unique child key means the
 * relationship is one-to-one rather than one-to-many.
 */
export function relationshipsOf(
  model: RelationalModel,
): readonly Relationship[] {
  const relationships: Relationship[] = [];

  for (const table of model.tables) {
    for (const foreignKey of table.foreignKeys) {
      const parentTable = findTable(model, foreignKey.referencesTable);

      const targetColumns =
        foreignKey.referencesColumns.length > 0
          ? foreignKey.referencesColumns
          : (parentTable?.primaryKey ?? []);

      const optional = foreignKey.columns.some((name) => {
        const column = findColumn(table, name);

        // An unknown column is assumed required; the parser reports it.
        return column?.nullable === true;
      });

      const oneToOne = isUniqueSet(table, foreignKey.columns);

      relationships.push({
        from: foreignKey.columns.map((column) => ({
          table: table.name,
          column,
        })),
        to: targetColumns.map((column) => ({
          table: foreignKey.referencesTable,
          column,
        })),
        parent: optional ? "zero-or-one" : "one",
        child: oneToOne ? "zero-or-one" : "zero-or-many",
        ...(foreignKey.name === undefined ? {} : { name: foreignKey.name }),
        foreignKey,
        childTable: table.name,
        parentTable: foreignKey.referencesTable,
      });
    }
  }

  return relationships;
}
