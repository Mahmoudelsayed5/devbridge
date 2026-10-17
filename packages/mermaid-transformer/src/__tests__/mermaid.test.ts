import { describe, expect, it } from "vitest";

import { parseSql } from "@devbridge/sql-transformer";

import type { MermaidOptions } from "../index.js";
import { generateMermaid, mermaidGenerator } from "../index.js";

function render(sql: string, options: MermaidOptions = {}): string {
  return generateMermaid(parseSql(sql).model, options);
}

const SHOP = `
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  nickname VARCHAR(50)
);
CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE profiles (
  user_id INT PRIMARY KEY REFERENCES users(id)
);
`;

describe("generateMermaid", () => {
  it("opens with erDiagram", () => {
    expect(render(SHOP).startsWith("erDiagram\n")).toBe(true);
  });

  it("draws a required many-to-one with crow's foot notation", () => {
    expect(render(SHOP)).toContain('users ||--o{ orders : "fk_orders_user"');
  });

  it("draws a one-to-one when the child key is unique", () => {
    expect(render(SHOP)).toContain('users ||--o| profiles : "user_id"');
  });

  it("makes the parent optional for a nullable foreign key", () => {
    const sql = `
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (id INT PRIMARY KEY, a_id INT NULL REFERENCES a(id));
    `;

    expect(render(sql)).toContain('a |o--o{ b : "a_id"');
  });

  it("emits an attribute block with key markers", () => {
    const output = render(SHOP);

    expect(output).toContain("users {");
    expect(output).toContain("int id PK");
    expect(output).toContain("varchar(255) email UK");
    expect(output).toContain("varchar(50) nickname");
    expect(output).toContain("int user_id FK");
  });

  it("replaces the comma in a multi-argument type", () => {
    // mermaid 11.15 rejects `decimal(10,2)`: "Expecting 'ATTRIBUTE_WORD',
    // got ','". Underscoring the comma keeps the precision and parses.
    const output = render(SHOP);

    expect(output).toContain("decimal(10_2) total");
    expect(output).not.toContain("decimal(10,2)");
  });

  it("never emits a comma inside an attribute type", () => {
    const output = render(`
      CREATE TABLE t (a NUMERIC(12,4), b DECIMAL(5,2), c VARCHAR(10));
    `);

    for (const line of output.split("\n")) {
      const trimmed = line.trim();

      // Key markers are the only legitimate comma on an attribute line.
      const beforeMarker = trimmed.split(" PK")[0]?.split(" FK")[0] ?? "";

      if (trimmed.includes("--") || trimmed.endsWith("{") || trimmed === "}") {
        continue;
      }

      expect(beforeMarker).not.toContain(",");
    }
  });

  it("shows both roles for a column that is a primary and foreign key", () => {
    expect(render(SHOP)).toContain("int user_id PK, FK");
  });

  it("never emits a type containing whitespace", () => {
    const output = render(`
      CREATE TABLE t (
        a TIMESTAMP WITH TIME ZONE,
        b DOUBLE PRECISION,
        c CHARACTER VARYING(40)
      );
    `);

    expect(output).toContain("timestamp_with_time_zone a");
    expect(output).toContain("double_precision b");
    expect(output).toContain("character_varying(40) c");

    // Every attribute line must be exactly type + name (+ optional marker).
    for (const line of output.split("\n")) {
      const trimmed = line.trim();

      if (
        trimmed.length === 0 ||
        trimmed === "erDiagram" ||
        trimmed.endsWith("{") ||
        trimmed === "}" ||
        trimmed.includes("--")
      ) {
        continue;
      }

      // type + name + up to two key markers ("PK, FK").
      expect(trimmed.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it("can drop type arguments", () => {
    const output = render(SHOP, { simpleTypes: true });

    expect(output).toContain("varchar email");
    expect(output).not.toContain("varchar(255)");
  });

  it("quotes entity names that are not bare words", () => {
    const output = render('CREATE TABLE "Order Items" (id INT);');

    expect(output).toContain('"Order Items" {');
  });

  it("sanitises column names that are not bare words", () => {
    const output = render('CREATE TABLE t ("first name" INT);');

    expect(output).toContain("int first_name");
  });

  it("can omit attributes but still declare entities", () => {
    const output = render(SHOP, { attributes: false });

    expect(output).toContain("users {");
    expect(output).not.toContain("email");
    expect(output).toContain("||--o{");
  });

  it("still renders a schema with no relationships", () => {
    const output = render("CREATE TABLE lonely (id INT PRIMARY KEY);");

    expect(output).toContain("erDiagram");
    expect(output).toContain("lonely {");
    expect(output).not.toContain("--");
  });

  it("exposes a single file through the registry entry", () => {
    const generated = mermaidGenerator.generate(parseSql(SHOP).model);

    expect(mermaidGenerator.id).toBe("mermaid");
    expect(mermaidGenerator.irKind).toBe("relational");
    expect(generated.files[0]?.path).toBe("erd.mmd");
    expect(generated.preview).toBe(generated.files[0]?.content);
  });
});
