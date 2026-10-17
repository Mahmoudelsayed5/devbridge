import type {
  Column,
  Diagnostic,
  ForeignKey,
  ParseOptions,
  RelationalModel,
  RelationalParseResult,
  RelationalSourceParser,
  ReferentialAction,
  Table,
  UniqueConstraint,
} from "@devbridge/core";
import { TransformationError } from "@devbridge/core";

import type { Token } from "./tokenizer.js";
import { tokenize } from "./tokenizer.js";

/** Words that end a column definition's type and begin its constraints. */
const CONSTRAINT_WORDS = new Set([
  "NOT", "NULL", "PRIMARY", "KEY", "UNIQUE", "DEFAULT", "REFERENCES", "CHECK",
  "AUTO_INCREMENT", "AUTOINCREMENT", "IDENTITY", "GENERATED", "COMMENT",
  "COLLATE", "CONSTRAINT", "ON", "STORED", "VIRTUAL", "AS", "SERIAL",
  "CHARACTER_SET", "ENCODING", "INVISIBLE", "VISIBLE",
]);

/** Words that continue a multi-word type name, e.g. DOUBLE PRECISION. */
const TYPE_CONTINUATION = new Set([
  "PRECISION", "VARYING", "UNSIGNED", "SIGNED", "ZEROFILL", "WITH", "WITHOUT",
  "TIME", "ZONE", "LOCAL", "BINARY",
]);

const ACTIONS: Readonly<Record<string, ReferentialAction>> = {
  CASCADE: "cascade",
  RESTRICT: "restrict",
  "SET NULL": "set null",
  "SET DEFAULT": "set default",
  "NO ACTION": "no action",
};

class Cursor {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    readonly input: string,
  ) {}

  peek(offset = 0): Token {
    return (
      this.tokens[Math.min(this.index + offset, this.tokens.length - 1)] as Token
    );
  }

  next(): Token {
    const token = this.peek();

    if (this.index < this.tokens.length - 1) {
      this.index += 1;
    }

    return token;
  }

  atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  /** True when the current token is the unquoted keyword `word`. */
  isKeyword(word: string, offset = 0): boolean {
    const token = this.peek(offset);

    return (
      token.kind === "word" &&
      !token.quoted &&
      token.value.toUpperCase() === word
    );
  }

  /** Consumes the keyword sequence when it matches, else leaves the cursor. */
  matchKeywords(...words: string[]): boolean {
    for (let i = 0; i < words.length; i += 1) {
      if (!this.isKeyword(words[i] as string, i)) {
        return false;
      }
    }

    for (let i = 0; i < words.length; i += 1) {
      this.next();
    }

    return true;
  }

  isSymbol(symbol: string, offset = 0): boolean {
    const token = this.peek(offset);

    return token.kind === "symbol" && token.value === symbol;
  }

  matchSymbol(symbol: string): boolean {
    if (this.isSymbol(symbol)) {
      this.next();

      return true;
    }

    return false;
  }

  /** Skips a balanced `( ... )` group, assuming the cursor is on the `(`. */
  skipParens(): void {
    if (!this.matchSymbol("(")) {
      return;
    }

    let depth = 1;

    while (!this.atEnd() && depth > 0) {
      if (this.isSymbol("(")) {
        depth += 1;
      } else if (this.isSymbol(")")) {
        depth -= 1;
      }

      this.next();
    }
  }
}

/** Reads `schema.table` or `db.schema.table`, returning the last two parts. */
function readQualifiedName(cursor: Cursor): { name: string; schema?: string } {
  const parts: string[] = [];

  parts.push(cursor.next().value);

  while (cursor.isSymbol(".")) {
    cursor.next();
    parts.push(cursor.next().value);
  }

  const name = parts[parts.length - 1] as string;
  const schema = parts.length > 1 ? (parts[parts.length - 2] as string) : undefined;

  return schema === undefined ? { name } : { name, schema };
}

/** Reads a parenthesised, comma-separated identifier list. */
function readColumnList(cursor: Cursor): string[] {
  const columns: string[] = [];

  if (!cursor.matchSymbol("(")) {
    return columns;
  }

  while (!cursor.atEnd() && !cursor.isSymbol(")")) {
    if (cursor.isSymbol(",")) {
      cursor.next();

      continue;
    }

    const token = cursor.next();

    if (token.kind === "word") {
      columns.push(token.value);

      // Ignore per-column index options such as ASC / DESC / (10).
      while (
        !cursor.atEnd() &&
        !cursor.isSymbol(",") &&
        !cursor.isSymbol(")")
      ) {
        if (cursor.isSymbol("(")) {
          cursor.skipParens();
        } else {
          cursor.next();
        }
      }
    }
  }

  cursor.matchSymbol(")");

  return columns;
}

function readAction(cursor: Cursor): ReferentialAction | undefined {
  if (cursor.matchKeywords("SET", "NULL")) {
    return ACTIONS["SET NULL"];
  }

  if (cursor.matchKeywords("SET", "DEFAULT")) {
    return ACTIONS["SET DEFAULT"];
  }

  if (cursor.matchKeywords("NO", "ACTION")) {
    return ACTIONS["NO ACTION"];
  }

  if (cursor.matchKeywords("CASCADE")) {
    return ACTIONS["CASCADE"];
  }

  if (cursor.matchKeywords("RESTRICT")) {
    return ACTIONS["RESTRICT"];
  }

  return undefined;
}

/** Parses `REFERENCES table [(cols)] [ON DELETE x] [ON UPDATE x]`. */
function readReferences(
  cursor: Cursor,
  columns: readonly string[],
  name: string | undefined,
): ForeignKey {
  const target = readQualifiedName(cursor);
  const referencesColumns = cursor.isSymbol("(") ? readColumnList(cursor) : [];

  let onDelete: ReferentialAction | undefined;
  let onUpdate: ReferentialAction | undefined;

  for (;;) {
    if (cursor.matchKeywords("ON", "DELETE")) {
      onDelete = readAction(cursor);

      continue;
    }

    if (cursor.matchKeywords("ON", "UPDATE")) {
      onUpdate = readAction(cursor);

      continue;
    }

    if (
      cursor.matchKeywords("DEFERRABLE") ||
      cursor.matchKeywords("NOT", "DEFERRABLE") ||
      cursor.matchKeywords("INITIALLY", "DEFERRED") ||
      cursor.matchKeywords("INITIALLY", "IMMEDIATE") ||
      cursor.matchKeywords("MATCH", "FULL") ||
      cursor.matchKeywords("MATCH", "PARTIAL") ||
      cursor.matchKeywords("MATCH", "SIMPLE")
    ) {
      continue;
    }

    break;
  }

  return {
    ...(name === undefined ? {} : { name }),
    columns: [...columns],
    referencesTable: target.name,
    referencesColumns,
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  };
}

/** Reads a type name including any parenthesised arguments. */
function readType(cursor: Cursor): string {
  const parts: string[] = [];
  const first = cursor.next();

  parts.push(first.value.toLowerCase());

  const readArgs = (): void => {
    if (!cursor.isSymbol("(")) {
      return;
    }

    const start = cursor.peek().offset;

    cursor.skipParens();

    const end = cursor.peek().offset;

    parts[parts.length - 1] +=
      cursor.input.slice(start, end).trim().replace(/\s+/g, "");
  };

  readArgs();

  while (
    cursor.peek().kind === "word" &&
    !cursor.peek().quoted &&
    TYPE_CONTINUATION.has(cursor.peek().value.toUpperCase())
  ) {
    parts.push(cursor.next().value.toLowerCase());
    readArgs();
  }

  return parts.join(" ");
}

interface ParsedColumn {
  column: Column;
  foreignKey?: ForeignKey;
}

function parseColumn(cursor: Cursor): ParsedColumn {
  const name = cursor.next().value;
  const dataType = readType(cursor);

  let nullable = true;
  let primaryKey = false;
  let unique = false;
  let autoIncrement = /^(serial|bigserial|smallserial)\b/.test(dataType);
  let defaultValue: string | undefined;
  let comment: string | undefined;
  let foreignKey: ForeignKey | undefined;

  if (autoIncrement) {
    // Postgres SERIAL implies NOT NULL plus a sequence default.
    nullable = false;
  }

  while (!cursor.atEnd() && !cursor.isSymbol(",") && !cursor.isSymbol(")")) {
    if (cursor.matchKeywords("NOT", "NULL")) {
      nullable = false;

      continue;
    }

    if (cursor.matchKeywords("NULL")) {
      nullable = true;

      continue;
    }

    if (cursor.matchKeywords("PRIMARY", "KEY")) {
      primaryKey = true;
      nullable = false;

      continue;
    }

    if (cursor.matchKeywords("UNIQUE", "KEY") || cursor.matchKeywords("UNIQUE")) {
      unique = true;

      continue;
    }

    if (
      cursor.matchKeywords("AUTO_INCREMENT") ||
      cursor.matchKeywords("AUTOINCREMENT")
    ) {
      autoIncrement = true;

      continue;
    }

    if (
      cursor.matchKeywords("GENERATED", "ALWAYS", "AS", "IDENTITY") ||
      cursor.matchKeywords("GENERATED", "BY", "DEFAULT", "AS", "IDENTITY") ||
      cursor.matchKeywords("IDENTITY")
    ) {
      autoIncrement = true;

      if (cursor.isSymbol("(")) {
        cursor.skipParens();
      }

      continue;
    }

    if (cursor.matchKeywords("DEFAULT")) {
      const start = cursor.peek().offset;

      // Consume the expression up to the next constraint word or separator.
      while (!cursor.atEnd() && !cursor.isSymbol(",") && !cursor.isSymbol(")")) {
        if (cursor.isSymbol("(")) {
          cursor.skipParens();

          continue;
        }

        const token = cursor.peek();

        if (
          token.kind === "word" &&
          !token.quoted &&
          CONSTRAINT_WORDS.has(token.value.toUpperCase())
        ) {
          break;
        }

        cursor.next();
      }

      defaultValue = cursor.input.slice(start, cursor.peek().offset).trim();

      continue;
    }

    if (cursor.matchKeywords("REFERENCES")) {
      foreignKey = readReferences(cursor, [name], undefined);

      continue;
    }

    if (cursor.matchKeywords("CHECK")) {
      cursor.skipParens();

      continue;
    }

    if (cursor.matchKeywords("COMMENT")) {
      const token = cursor.peek();

      if (token.kind === "string") {
        comment = cursor.next().value;
      }

      continue;
    }

    // Anything else (COLLATE x, CHARACTER SET y, ON UPDATE CURRENT_TIMESTAMP,
    // storage hints) is not needed by any target, so step over it.
    if (cursor.isSymbol("(")) {
      cursor.skipParens();

      continue;
    }

    cursor.next();
  }

  const column: Column = {
    name,
    dataType,
    nullable,
    primaryKey,
    unique,
    autoIncrement,
    ...(defaultValue === undefined || defaultValue.length === 0
      ? {}
      : { defaultValue }),
    ...(comment === undefined ? {} : { comment }),
  };

  return foreignKey === undefined ? { column } : { column, foreignKey };
}

interface TableBuilder {
  name: string;
  schema?: string;
  columns: Column[];
  primaryKey: string[];
  uniques: UniqueConstraint[];
  foreignKeys: ForeignKey[];
  comment?: string;
}

function parseCreateTable(cursor: Cursor): TableBuilder | undefined {
  cursor.matchKeywords("IF", "NOT", "EXISTS");

  if (cursor.peek().kind !== "word") {
    return undefined;
  }

  const { name, schema } = readQualifiedName(cursor);

  const table: TableBuilder = {
    name,
    ...(schema === undefined ? {} : { schema }),
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
  };

  // CREATE TABLE x AS SELECT ... / LIKE y have no column list to read.
  if (!cursor.isSymbol("(")) {
    return table;
  }

  cursor.next();

  while (!cursor.atEnd() && !cursor.isSymbol(")")) {
    if (cursor.isSymbol(",")) {
      cursor.next();

      continue;
    }

    let constraintName: string | undefined;

    if (cursor.matchKeywords("CONSTRAINT")) {
      if (cursor.peek().kind === "word" && !cursor.isKeyword("PRIMARY")) {
        constraintName = cursor.next().value;
      }
    }

    if (cursor.matchKeywords("PRIMARY", "KEY")) {
      table.primaryKey = readColumnList(cursor);

      continue;
    }

    if (
      cursor.matchKeywords("UNIQUE", "KEY") ||
      cursor.matchKeywords("UNIQUE", "INDEX") ||
      cursor.matchKeywords("UNIQUE")
    ) {
      // MySQL allows an index name before the column list.
      if (cursor.peek().kind === "word" && !cursor.isSymbol("(")) {
        constraintName = cursor.next().value;
      }

      table.uniques.push({
        ...(constraintName === undefined ? {} : { name: constraintName }),
        columns: readColumnList(cursor),
      });

      continue;
    }

    if (cursor.matchKeywords("FOREIGN", "KEY")) {
      if (cursor.peek().kind === "word" && !cursor.isSymbol("(")) {
        constraintName = cursor.next().value;
      }

      const columns = readColumnList(cursor);

      if (cursor.matchKeywords("REFERENCES")) {
        table.foreignKeys.push(readReferences(cursor, columns, constraintName));
      }

      continue;
    }

    if (cursor.matchKeywords("CHECK")) {
      cursor.skipParens();

      continue;
    }

    // MySQL secondary indexes carry no information any target needs.
    if (
      cursor.matchKeywords("KEY") ||
      cursor.matchKeywords("INDEX") ||
      cursor.matchKeywords("FULLTEXT") ||
      cursor.matchKeywords("SPATIAL")
    ) {
      while (!cursor.atEnd() && !cursor.isSymbol("(") && !cursor.isSymbol(",")) {
        cursor.next();
      }

      if (cursor.isSymbol("(")) {
        cursor.skipParens();
      }

      continue;
    }

    if (cursor.peek().kind !== "word") {
      cursor.next();

      continue;
    }

    const parsed = parseColumn(cursor);

    table.columns.push(parsed.column);

    if (parsed.column.primaryKey && !table.primaryKey.includes(parsed.column.name)) {
      table.primaryKey.push(parsed.column.name);
    }

    if (parsed.foreignKey !== undefined) {
      table.foreignKeys.push(parsed.foreignKey);
    }
  }

  cursor.matchSymbol(")");

  // Trailing table options; COMMENT is the only one worth keeping.
  while (!cursor.atEnd() && !cursor.isSymbol(";")) {
    if (cursor.matchKeywords("COMMENT")) {
      cursor.matchSymbol("=");

      if (cursor.peek().kind === "string") {
        table.comment = cursor.next().value;
      }

      continue;
    }

    cursor.next();
  }

  return table;
}

function parseAlterTable(cursor: Cursor, tables: Map<string, TableBuilder>): void {
  cursor.matchKeywords("IF", "EXISTS");
  cursor.matchKeywords("ONLY");

  if (cursor.peek().kind !== "word") {
    return;
  }

  const { name } = readQualifiedName(cursor);
  const table = tables.get(name.toLowerCase());

  while (!cursor.atEnd() && !cursor.isSymbol(";")) {
    if (!cursor.matchKeywords("ADD")) {
      cursor.next();

      continue;
    }

    cursor.matchKeywords("COLUMN");

    let constraintName: string | undefined;

    if (cursor.matchKeywords("CONSTRAINT") && cursor.peek().kind === "word") {
      constraintName = cursor.next().value;
    }

    if (cursor.matchKeywords("FOREIGN", "KEY")) {
      const columns = readColumnList(cursor);

      if (cursor.matchKeywords("REFERENCES")) {
        const foreignKey = readReferences(cursor, columns, constraintName);

        table?.foreignKeys.push(foreignKey);
      }

      continue;
    }

    if (cursor.matchKeywords("PRIMARY", "KEY")) {
      const columns = readColumnList(cursor);

      if (table !== undefined && columns.length > 0) {
        table.primaryKey = columns;
      }

      continue;
    }

    if (cursor.matchKeywords("UNIQUE")) {
      const columns = readColumnList(cursor);

      if (table !== undefined && columns.length > 0) {
        table.uniques.push({
          ...(constraintName === undefined ? {} : { name: constraintName }),
          columns,
        });
      }

      continue;
    }
  }
}

function parseCreateIndex(cursor: Cursor, tables: Map<string, TableBuilder>): void {
  const unique = cursor.matchKeywords("UNIQUE");

  if (!cursor.matchKeywords("INDEX")) {
    return;
  }

  cursor.matchKeywords("CONCURRENTLY");
  cursor.matchKeywords("IF", "NOT", "EXISTS");

  let indexName: string | undefined;

  if (cursor.peek().kind === "word" && !cursor.isKeyword("ON")) {
    indexName = cursor.next().value;
  }

  if (!cursor.matchKeywords("ON")) {
    return;
  }

  const { name } = readQualifiedName(cursor);

  cursor.matchKeywords("USING");

  if (cursor.peek().kind === "word" && !cursor.isSymbol("(")) {
    cursor.next();
  }

  const columns = readColumnList(cursor);

  if (unique && columns.length > 0) {
    tables.get(name.toLowerCase())?.uniques.push({
      ...(indexName === undefined ? {} : { name: indexName }),
      columns,
    });
  }
}

const EMPTY_INPUT: Diagnostic = {
  severity: "error",
  code: "sql/empty-input",
  message: "The input is empty.",
  line: 1,
  column: 1,
  hint: "Paste or load a SQL schema first.",
};

const NO_TABLES: Diagnostic = {
  severity: "error",
  code: "sql/no-tables",
  message: "No CREATE TABLE statement was found.",
  line: 1,
  column: 1,
  hint: "DevBridge reads CREATE TABLE and ALTER TABLE ... ADD CONSTRAINT.",
};

function build(cursor: Cursor): {
  tables: Map<string, TableBuilder>;
  statements: number;
} {
  const tables = new Map<string, TableBuilder>();
  const alters: (() => void)[] = [];
  let statements = 0;

  while (!cursor.atEnd()) {
    if (cursor.isSymbol(";")) {
      cursor.next();

      continue;
    }

    if (cursor.matchKeywords("CREATE")) {
      statements += 1;
      cursor.matchKeywords("OR", "REPLACE");
      cursor.matchKeywords("GLOBAL");
      cursor.matchKeywords("LOCAL");
      cursor.matchKeywords("TEMPORARY");
      cursor.matchKeywords("TEMP");
      cursor.matchKeywords("UNLOGGED");

      if (cursor.matchKeywords("TABLE")) {
        const table = parseCreateTable(cursor);

        if (table !== undefined) {
          tables.set(table.name.toLowerCase(), table);
        }

        continue;
      }

      // CREATE [UNIQUE] INDEX must run after every table exists.
      if (cursor.isKeyword("UNIQUE") || cursor.isKeyword("INDEX")) {
        const saved = cursor;

        const tokensStart = saved.peek().offset;

        // Re-parse lazily so the index can attach to a table declared later.
        const text = saved.input;

        while (!cursor.atEnd() && !cursor.isSymbol(";")) {
          cursor.next();
        }

        const tokensEnd = cursor.peek().offset;

        alters.push(() => {
          parseCreateIndex(
            new Cursor(tokenize(text.slice(tokensStart, tokensEnd)), text),
            tables,
          );
        });

        continue;
      }

      continue;
    }

    if (cursor.matchKeywords("ALTER")) {
      statements += 1;

      if (cursor.matchKeywords("TABLE")) {
        const start = cursor.peek().offset;
        const text = cursor.input;

        while (!cursor.atEnd() && !cursor.isSymbol(";")) {
          cursor.next();
        }

        const end = cursor.peek().offset;

        // Deferred: an ALTER may reference a table created further down.
        alters.push(() => {
          parseAlterTable(
            new Cursor(tokenize(text.slice(start, end)), text),
            tables,
          );
        });

        continue;
      }

      continue;
    }

    cursor.next();
  }

  for (const apply of alters) {
    apply();
  }

  return { tables, statements };
}

function toModel(tables: Map<string, TableBuilder>): RelationalModel {
  return {
    tables: [...tables.values()].map(
      (table): Table => ({
        name: table.name,
        ...(table.schema === undefined ? {} : { schema: table.schema }),
        columns: table.columns,
        primaryKey: table.primaryKey,
        uniques: table.uniques,
        foreignKeys: table.foreignKeys,
        ...(table.comment === undefined ? {} : { comment: table.comment }),
      }),
    ),
  };
}

/** Reports foreign keys whose target table or column is not in the schema. */
function checkReferences(model: RelationalModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byName = new Map(
    model.tables.map((table) => [table.name.toLowerCase(), table]),
  );

  for (const table of model.tables) {
    for (const foreignKey of table.foreignKeys) {
      const target = byName.get(foreignKey.referencesTable.toLowerCase());

      if (target === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "sql/unknown-reference",
          message: `${table.name}.${foreignKey.columns.join(", ")} references "${foreignKey.referencesTable}", which is not defined here.`,
          hint: "The relationship is still drawn; include that table for a complete diagram.",
        });

        continue;
      }

      if (
        foreignKey.referencesColumns.length === 0 &&
        target.primaryKey.length === 0
      ) {
        diagnostics.push({
          severity: "warning",
          code: "sql/unresolved-reference",
          message: `${table.name} references "${target.name}" without naming a column, and "${target.name}" has no primary key.`,
        });
      }
    }
  }

  return diagnostics;
}

/** Reports every problem that would stop `parseSql` from producing IR. */
export function validateSql(input: string): readonly Diagnostic[] {
  if (input.trim().length === 0) {
    return [EMPTY_INPUT];
  }

  const { tables } = build(new Cursor(tokenize(input), input));

  if (tables.size === 0) {
    return [NO_TABLES];
  }

  return checkReferences(toModel(tables));
}

/**
 * Parses a SQL schema into the relational IR.
 *
 * @throws {TransformationError} when no table can be read.
 */
export function parseSql(
  input: string,
  _options: ParseOptions = {},
): RelationalParseResult {
  if (input.trim().length === 0) {
    throw new TransformationError(EMPTY_INPUT.message, [EMPTY_INPUT]);
  }

  const { tables } = build(new Cursor(tokenize(input), input));

  if (tables.size === 0) {
    throw new TransformationError(NO_TABLES.message, [NO_TABLES]);
  }

  const model = toModel(tables);

  return { model, diagnostics: checkReferences(model) };
}

export const sqlParser: RelationalSourceParser = {
  id: "sql",
  irKind: "relational",
  label: "SQL",
  extensions: ["sql", "ddl"],
  parse: (input, options) => parseSql(input, options ?? {}),
  validate: validateSql,
};
