import { describe, expect, it } from "vitest";

import { parseSql } from "@devbridge/sql-transformer";

import { generateDbml } from "../index.js";

/**
 * Parses the generated DBML with the official @dbml/core parser.
 *
 * The sibling suite asserts what the text looks like; this asserts the text
 * is actually valid DBML, which is the claim that matters when a user pastes
 * it into dbdiagram.io. It is the DBML equivalent of running `javac` over the
 * generated Java.
 */
async function parseDbml(dbml: string): Promise<unknown> {
  const { Parser } = await import("@dbml/core");

  return new Parser().parse(dbml, "dbml");
}

const SCHEMA = `
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(10) DEFAULT 'new'
);
CREATE TABLE profiles (
  user_id INT PRIMARY KEY REFERENCES users(id),
  bio TEXT
);
CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE order_items (
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT uq_item UNIQUE (order_id, quantity),
  FOREIGN KEY (order_id) REFERENCES orders (id)
);
`;

describe("generated DBML is valid DBML", () => {
  it("parses a full schema with the official parser", async () => {
    const dbml = generateDbml(parseSql(SCHEMA).model, { projectName: "shop" });

    await expect(parseDbml(dbml)).resolves.toBeDefined();
  });

  it("parses composite keys, indexes and refs", async () => {
    const dbml = generateDbml(parseSql(SCHEMA).model);
    const database = (await parseDbml(dbml)) as {
      schemas: { tables: { name: string }[]; refs: unknown[] }[];
    };

    const schema = database.schemas[0];

    expect(schema?.tables.map((table) => table.name)).toEqual([
      "users",
      "profiles",
      "orders",
      "order_items",
    ]);

    expect(schema?.refs.length).toBe(3);
  });

  it("parses quoted identifiers and schema qualification", async () => {
    const dbml = generateDbml(
      parseSql(`
        CREATE TABLE "public"."Order Items" ("Item Id" INT PRIMARY KEY, qty INT);
      `).model,
    );

    await expect(parseDbml(dbml)).resolves.toBeDefined();
  });

  it("parses every default-value shape we emit", async () => {
    const dbml = generateDbml(
      parseSql(`
        CREATE TABLE t (
          a INT DEFAULT 5,
          b VARCHAR(10) DEFAULT 'hi',
          c TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          d BOOLEAN DEFAULT TRUE,
          e INT DEFAULT -1
        );
      `).model,
    );

    await expect(parseDbml(dbml)).resolves.toBeDefined();
  });
});
