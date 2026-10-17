import { describe, expect, it } from "vitest";

import { TransformationError } from "@devbridge/core";

import {
  listSources,
  listTargets,
  sourceForFile,
  targetsFor,
  transform,
  validate,
} from "../index.js";

const JSON_SAMPLE = JSON.stringify({
  id: 1,
  user: { name: "Mahmoud", tags: ["java"] },
  orders: [{ total: 9.99 }, { total: 5, note: "gift" }],
});

const SQL_SAMPLE = `
CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id)
);
`;

const TYPE_GRAPH_TARGETS = ["typescript", "java", "go", "python", "csharp"];
const RELATIONAL_TARGETS = ["mermaid", "dbml"];

describe("registries", () => {
  it("lists both source families", () => {
    expect(listSources().map((format) => format.id)).toEqual(["json", "sql"]);

    expect(listSources().map((format) => format.irKind)).toEqual([
      "type-graph",
      "relational",
    ]);
  });

  it("lists every target with the family it reads", () => {
    expect(listTargets().map((format) => format.id)).toEqual([
      ...TYPE_GRAPH_TARGETS,
      ...RELATIONAL_TARGETS,
    ]);
  });

  it("resolves a source parser from a file name", () => {
    expect(sourceForFile("schema.JSON")?.id).toBe("json");
    expect(sourceForFile("schema.sql")?.id).toBe("sql");
    expect(sourceForFile("schema.ddl")?.id).toBe("sql");
    expect(sourceForFile("schema.yaml")).toBeUndefined();
    expect(sourceForFile("schema")).toBeUndefined();
  });
});

describe("targetsFor", () => {
  it("offers only targets that can read the source's IR", () => {
    expect(targetsFor("json").map((t) => t.id)).toEqual(TYPE_GRAPH_TARGETS);
    expect(targetsFor("sql").map((t) => t.id)).toEqual(RELATIONAL_TARGETS);
    expect(targetsFor("nope")).toEqual([]);
  });
});

describe("transform", () => {
  it("drives every language generator from the same JSON", () => {
    for (const target of TYPE_GRAPH_TARGETS) {
      const result = transform({
        input: JSON_SAMPLE,
        source: "json",
        target,
      });

      expect(result.target).toBe(target);
      expect(result.irKind).toBe("type-graph");
      expect(result.names).toEqual(["Root", "User", "OrdersItem"]);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.preview.length).toBeGreaterThan(0);
    }
  });

  it("drives every diagram generator from the same SQL", () => {
    for (const target of RELATIONAL_TARGETS) {
      const result = transform({ input: SQL_SAMPLE, source: "sql", target });

      expect(result.target).toBe(target);
      expect(result.irKind).toBe("relational");
      expect(result.names).toEqual(["users", "orders"]);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.preview).toContain("users");
    }
  });

  it("exposes the IR it produced, discriminated by family", () => {
    const json = transform({
      input: JSON_SAMPLE,
      source: "json",
      target: "typescript",
    });

    if (json.ir.kind !== "type-graph") {
      throw new Error("expected a type graph");
    }

    expect(json.ir.root.name).toBe("Root");
    expect(json.ir.context.getTypes().length).toBe(3);

    const sql = transform({
      input: SQL_SAMPLE,
      source: "sql",
      target: "dbml",
    });

    if (sql.ir.kind !== "relational") {
      throw new Error("expected a relational model");
    }

    expect(sql.ir.model.tables).toHaveLength(2);
  });

  it("refuses to pair a source and target from different families", () => {
    expect(() =>
      transform({ input: JSON_SAMPLE, source: "json", target: "mermaid" }),
    ).toThrow(TransformationError);

    expect(() =>
      transform({ input: SQL_SAMPLE, source: "sql", target: "java" }),
    ).toThrow(/cannot read SQL/);
  });

  it("names the usable targets when the pairing is wrong", () => {
    try {
      transform({ input: JSON_SAMPLE, source: "json", target: "dbml" });
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as Error).message).toContain("typescript, java");
      expect((error as Error).message).toContain("database schemas");
    }
  });

  it("passes options through to the parser and the generator", () => {
    const result = transform({
      input: JSON_SAMPLE,
      source: "json",
      target: "java",
      parseOptions: { rootName: "Payload" },
      generatorOptions: { packageName: "com.example" },
    });

    expect(result.names[0]).toBe("Payload");
    expect(result.files.map((file) => file.path)).toContain("Payload.java");
    expect(result.preview).toContain("package com.example;");
  });

  it("reports an unknown source or target", () => {
    expect(() =>
      transform({ input: JSON_SAMPLE, source: "yaml", target: "java" }),
    ).toThrow(TransformationError);

    expect(() =>
      transform({ input: JSON_SAMPLE, source: "json", target: "rust" }),
    ).toThrow(/Unknown target format "rust"/);
  });

  it("surfaces parse failures instead of silently succeeding", () => {
    expect(() =>
      transform({ input: "{ bad", source: "json", target: "typescript" }),
    ).toThrow(TransformationError);

    expect(() =>
      transform({ input: "SELECT 1", source: "sql", target: "dbml" }),
    ).toThrow(TransformationError);
  });

  it("carries parser warnings into the result", () => {
    const result = transform({
      input: "CREATE TABLE orders (user_id INT REFERENCES users(id));",
      source: "sql",
      target: "mermaid",
    });

    expect(result.diagnostics.map((d) => d.code)).toContain(
      "sql/unknown-reference",
    );
  });
});

describe("validate", () => {
  it("returns no diagnostics for valid artifacts", () => {
    expect(validate(JSON_SAMPLE, "json")).toEqual([]);
    expect(validate(SQL_SAMPLE, "sql")).toEqual([]);
  });

  it("returns a located diagnostic for a broken artifact", () => {
    const diagnostics = validate("{ bad", "json");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("json/invalid-syntax");

    expect(validate("SELECT 1", "sql")[0]?.code).toBe("sql/no-tables");
  });
});
