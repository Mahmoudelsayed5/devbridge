import { describe, expect, it } from "vitest";

import { findTable, relationshipsOf } from "@devbridge/core";

import { parseSql, validateSql } from "../index.js";

const SCHEMA = `
-- Users and their orders
CREATE TABLE users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(100),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id        INT PRIMARY KEY,
  user_id   INT NOT NULL,
  total     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  note      TEXT,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
`;

describe("parseSql", () => {
  it("reads tables and columns", () => {
    const { model } = parseSql(SCHEMA);

    expect(model.tables.map((table) => table.name)).toEqual([
      "users",
      "orders",
    ]);

    const users = findTable(model, "users");

    expect(users?.columns.map((column) => column.name)).toEqual([
      "id",
      "email",
      "display_name",
      "created_at",
    ]);
  });

  it("reads types including their arguments", () => {
    const { model } = parseSql(SCHEMA);
    const types = findTable(model, "orders")?.columns.map((c) => c.dataType);

    expect(types).toEqual(["int", "int", "decimal(10,2)", "text"]);
  });

  it("tracks nullability, keys and auto increment", () => {
    const { model } = parseSql(SCHEMA);
    const users = findTable(model, "users");

    const id = users?.columns[0];
    const email = users?.columns[1];
    const displayName = users?.columns[2];

    expect(id).toMatchObject({
      primaryKey: true,
      nullable: false,
      autoIncrement: true,
    });
    expect(email).toMatchObject({ nullable: false, unique: true });
    expect(displayName).toMatchObject({ nullable: true, primaryKey: false });
    expect(users?.primaryKey).toEqual(["id"]);
  });

  it("captures default expressions verbatim", () => {
    const { model } = parseSql(SCHEMA);

    expect(findTable(model, "users")?.columns[3]?.defaultValue).toBe(
      "CURRENT_TIMESTAMP",
    );
    expect(findTable(model, "orders")?.columns[2]?.defaultValue).toBe("0.00");
  });

  it("reads a named table-level foreign key with its action", () => {
    const { model } = parseSql(SCHEMA);
    const [foreignKey] = findTable(model, "orders")?.foreignKeys ?? [];

    expect(foreignKey).toMatchObject({
      name: "fk_orders_user",
      columns: ["user_id"],
      referencesTable: "users",
      referencesColumns: ["id"],
      onDelete: "cascade",
    });
  });

  it("reads an inline column-level reference", () => {
    const { model } = parseSql(`
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (a_id INT REFERENCES a(id) ON UPDATE RESTRICT);
    `);

    expect(findTable(model, "b")?.foreignKeys[0]).toMatchObject({
      columns: ["a_id"],
      referencesTable: "a",
      referencesColumns: ["id"],
      onUpdate: "restrict",
    });
  });

  it("applies ALTER TABLE constraints, even before the table is declared", () => {
    const { model } = parseSql(`
      ALTER TABLE orders ADD CONSTRAINT fk1 FOREIGN KEY (user_id) REFERENCES users(id);
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (id INT, user_id INT NOT NULL);
    `);

    expect(findTable(model, "orders")?.foreignKeys[0]).toMatchObject({
      name: "fk1",
      referencesTable: "users",
    });
  });

  it("reads composite primary keys and unique constraints", () => {
    const { model } = parseSql(`
      CREATE TABLE memberships (
        user_id INT NOT NULL,
        group_id INT NOT NULL,
        role VARCHAR(20),
        PRIMARY KEY (user_id, group_id),
        CONSTRAINT uq_role UNIQUE (group_id, role)
      );
    `);

    const table = findTable(model, "memberships");

    expect(table?.primaryKey).toEqual(["user_id", "group_id"]);
    expect(table?.uniques).toEqual([
      { name: "uq_role", columns: ["group_id", "role"] },
    ]);
  });

  it("picks up a UNIQUE index declared separately", () => {
    const { model } = parseSql(`
      CREATE TABLE t (a INT, b INT);
      CREATE UNIQUE INDEX uq_t_a ON t (a);
      CREATE INDEX ix_t_b ON t (b);
    `);

    expect(findTable(model, "t")?.uniques).toEqual([
      { name: "uq_t_a", columns: ["a"] },
    ]);
  });

  it("handles quoted identifiers in every dialect's style", () => {
    const { model } = parseSql(`
      CREATE TABLE "public"."Order Items" ("Item Id" INT PRIMARY KEY);
      CREATE TABLE \`back ticks\` (\`id\` INT);
      CREATE TABLE [brackets] ([id] INT);
    `);

    expect(model.tables.map((table) => table.name)).toEqual([
      "Order Items",
      "back ticks",
      "brackets",
    ]);

    expect(findTable(model, "Order Items")?.schema).toBe("public");
    expect(findTable(model, "Order Items")?.columns[0]?.name).toBe("Item Id");
  });

  it("treats a quoted keyword as an ordinary column name", () => {
    const { model } = parseSql('CREATE TABLE t ("key" INT, "unique" TEXT);');

    expect(findTable(model, "t")?.columns.map((c) => c.name)).toEqual([
      "key",
      "unique",
    ]);
  });

  it("reads multi-word and Postgres types", () => {
    const { model } = parseSql(`
      CREATE TABLE t (
        a DOUBLE PRECISION,
        b CHARACTER VARYING(40),
        c TIMESTAMP WITH TIME ZONE,
        d INT UNSIGNED,
        e BIGSERIAL
      );
    `);

    const types = findTable(model, "t")?.columns.map((c) => c.dataType);

    expect(types).toEqual([
      "double precision",
      "character varying(40)",
      "timestamp with time zone",
      "int unsigned",
      "bigserial",
    ]);
  });

  it("treats SERIAL as an auto-incrementing non-null column", () => {
    const { model } = parseSql("CREATE TABLE t (id SERIAL PRIMARY KEY);");

    expect(findTable(model, "t")?.columns[0]).toMatchObject({
      autoIncrement: true,
      nullable: false,
    });
  });

  it("reads GENERATED ... AS IDENTITY", () => {
    const { model } = parseSql(`
      CREATE TABLE t (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
    `);

    expect(findTable(model, "t")?.columns[0]?.autoIncrement).toBe(true);
  });

  it("skips CHECK constraints and MySQL index clauses", () => {
    const { model } = parseSql(`
      CREATE TABLE t (
        id INT PRIMARY KEY,
        age INT CHECK (age >= 0),
        name VARCHAR(10),
        KEY ix_name (name),
        CHECK (id > 0)
      ) ENGINE=InnoDB COMMENT='people';
    `);

    const table = findTable(model, "t");

    expect(table?.columns.map((c) => c.name)).toEqual(["id", "age", "name"]);
    expect(table?.comment).toBe("people");
  });

  it("ignores comments and unrelated statements", () => {
    const { model } = parseSql(`
      /* block
         comment */
      INSERT INTO t VALUES (1);
      -- line comment
      CREATE TABLE t (id INT); # mysql comment
      DROP VIEW v;
    `);

    expect(model.tables).toHaveLength(1);
  });

  it("does not mistake a semicolon inside a string for a statement end", () => {
    const { model } = parseSql(
      "CREATE TABLE t (a VARCHAR(10) DEFAULT 'x;y', b INT);",
    );

    expect(findTable(model, "t")?.columns.map((c) => c.name)).toEqual([
      "a",
      "b",
    ]);
    expect(findTable(model, "t")?.columns[0]?.defaultValue).toBe("'x;y'");
  });

  it("rejects input with no tables", () => {
    expect(() => parseSql("SELECT 1;")).toThrow("No CREATE TABLE");
    expect(() => parseSql("   ")).toThrow("The input is empty.");
  });
});

describe("validateSql", () => {
  it("is quiet for a complete schema", () => {
    expect(validateSql(SCHEMA)).toEqual([]);
  });

  it("reports an empty or tableless document", () => {
    expect(validateSql("")[0]?.code).toBe("sql/empty-input");
    expect(validateSql("SELECT 1")[0]?.code).toBe("sql/no-tables");
  });

  it("warns about a foreign key to a table that is not present", () => {
    const diagnostics = validateSql(`
      CREATE TABLE orders (id INT, user_id INT REFERENCES users(id));
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "warning",
      code: "sql/unknown-reference",
    });
  });
});

describe("relationshipsOf", () => {
  it("derives cardinality from nullability and uniqueness", () => {
    const { model } = parseSql(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (id INT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id));
      CREATE TABLE profiles (user_id INT PRIMARY KEY REFERENCES users(id));
      CREATE TABLE drafts (id INT PRIMARY KEY, user_id INT NULL REFERENCES users(id));
    `);

    const byChild = new Map(
      relationshipsOf(model).map((r) => [r.childTable, r]),
    );

    // Required many-to-one.
    expect(byChild.get("orders")).toMatchObject({
      parent: "one",
      child: "zero-or-many",
    });

    // The child key is the primary key, so it is one-to-one.
    expect(byChild.get("profiles")).toMatchObject({
      parent: "one",
      child: "zero-or-one",
    });

    // Nullable foreign key makes the parent side optional.
    expect(byChild.get("drafts")).toMatchObject({
      parent: "zero-or-one",
      child: "zero-or-many",
    });
  });

  it("falls back to the parent's primary key when no column is named", () => {
    const { model } = parseSql(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (user_id INT NOT NULL REFERENCES users);
    `);

    expect(relationshipsOf(model)[0]?.to).toEqual([
      { table: "users", column: "id" },
    ]);
  });
});
