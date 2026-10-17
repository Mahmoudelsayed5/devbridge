import { describe, expect, it } from "vitest";

import { parseSql } from "@devbridge/sql-transformer";

import type { DbmlOptions } from "../index.js";
import { dbmlGenerator, generateDbml } from "../index.js";

function render(sql: string, options: DbmlOptions = {}): string {
  return generateDbml(parseSql(sql).model, options);
}

const SHOP = `
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  nickname VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

describe("generateDbml", () => {
  it("emits a Table block per table with full types", () => {
    const output = render(SHOP);

    expect(output).toContain("Table users {");
    expect(output).toContain("email varchar(255) [not null, unique]");
    expect(output).toContain("total decimal(10,2) [not null, default: 0.00]");
  });

  it("marks a single column primary key inline with increment", () => {
    expect(render(SHOP)).toContain("id int [pk, increment]");
  });

  it("does not repeat not-null on a primary key", () => {
    expect(render(SHOP)).not.toContain("[pk, increment, not null]");
  });

  it("writes an expression default in backticks and a literal plainly", () => {
    const output = render(SHOP);

    expect(output).toContain("default: `CURRENT_TIMESTAMP`");
    expect(output).toContain("default: 0.00");
  });

  it("writes a quoted SQL literal as a DBML string", () => {
    const output = render(
      "CREATE TABLE t (status VARCHAR(10) DEFAULT 'new');",
    );

    expect(output).toContain("default: 'new'");
  });

  it("emits references with their cardinality and actions", () => {
    expect(render(SHOP)).toContain(
      "Ref fk_orders_user: orders.user_id > users.id [delete: cascade]",
    );
  });

  it("uses a one-to-one ref when the child key is unique", () => {
    const output = render(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE profiles (user_id INT PRIMARY KEY REFERENCES users(id));
    `);

    expect(output).toContain("Ref: profiles.user_id - users.id");
  });

  it("puts a composite primary key in an indexes block", () => {
    const output = render(`
      CREATE TABLE memberships (
        user_id INT NOT NULL,
        group_id INT NOT NULL,
        role VARCHAR(20),
        PRIMARY KEY (user_id, group_id),
        CONSTRAINT uq_role UNIQUE (group_id, role)
      );
    `);

    expect(output).toContain("indexes {");
    expect(output).toContain("(user_id, group_id) [pk]");
    expect(output).toContain("(group_id, role) [unique, name: 'uq_role']");
    expect(output).not.toContain("user_id int [pk");
  });

  it("quotes identifiers that are not bare words", () => {
    const output = render('CREATE TABLE "Order Items" ("Item Id" INT);');

    expect(output).toContain('Table "Order Items" {');
    expect(output).toContain('"Item Id" int');
  });

  it("qualifies a table with its schema", () => {
    expect(render('CREATE TABLE "public"."t" (id INT);')).toContain(
      "Table public.t {",
    );
  });

  it("carries comments through as notes", () => {
    const output = render(`
      CREATE TABLE t (
        id INT COMMENT 'the id'
      ) COMMENT='a table';
    `);

    expect(output).toContain("note: 'the id'");
    expect(output).toContain("Note: 'a table'");
  });

  it("can emit a Project block", () => {
    expect(render(SHOP, { projectName: "shop" })).toContain("Project shop {");
  });

  it("handles a composite foreign key", () => {
    const output = render(`
      CREATE TABLE parent (a INT, b INT, PRIMARY KEY (a, b));
      CREATE TABLE child (
        a INT NOT NULL, b INT NOT NULL,
        FOREIGN KEY (a, b) REFERENCES parent (a, b)
      );
    `);

    expect(output).toContain("Ref: (child.a, child.b) > (parent.a, parent.b)");
  });

  it("exposes a single file through the registry entry", () => {
    const generated = dbmlGenerator.generate(parseSql(SHOP).model);

    expect(dbmlGenerator.id).toBe("dbml");
    expect(dbmlGenerator.irKind).toBe("relational");
    expect(generated.files[0]?.path).toBe("schema.dbml");
  });
});
