import { describe, expect, it } from "vitest";

import { buildGeneratorOptions, DEFAULT_OPTIONS, TARGETS } from "../options.js";
import {
  availableSources,
  availableTargets,
  runTransform,
  targetsForSource,
  validateInput,
} from "../transform.js";

const SAMPLE = JSON.stringify({
  id: 1,
  "user-name": "Mahmoud",
  address: { city: "Cairo" },
  orders: [{ total: 1 }, { total: 2, note: "x" }],
});

const SQL_SAMPLE = `
  CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
  CREATE TABLE orders (id INT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id));
`;

/** An input each source format can actually parse. */
const INPUT_FOR: Readonly<Record<string, string>> = {
  json: SAMPLE,
  sql: SQL_SAMPLE,
};

describe("runTransform", () => {
  it("reports an empty document as empty, not as an error", () => {
    const outcome = runTransform("   ", "typescript");

    expect(outcome.status).toBe("empty");
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.files).toEqual([]);
  });

  it("produces files and type names for a valid document", () => {
    const outcome = runTransform(SAMPLE, "typescript");

    expect(outcome.status).toBe("ok");
    expect(outcome.types).toEqual(["Root", "Address", "OrdersItem"]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.preview).toContain("export interface Root");
  });

  it("returns diagnostics instead of throwing on bad input", () => {
    const outcome = runTransform("{ not json", "typescript");

    expect(outcome.status).toBe("invalid");
    expect(outcome.diagnostics.length).toBeGreaterThan(0);
    expect(outcome.diagnostics[0]?.severity).toBe("error");
    expect(outcome.files).toEqual([]);
  });

  it("never returns an invalid status with no diagnostic to show", () => {
    for (const input of ["{ not json", '"a string"', "[]", "[1,2]"]) {
      const outcome = runTransform(input, "java");

      expect(outcome.status).toBe("invalid");
      expect(outcome.diagnostics.length).toBeGreaterThan(0);
      expect(outcome.diagnostics[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it("reports an unknown target as a diagnostic", () => {
    const outcome = runTransform(SAMPLE, "rust");

    expect(outcome.status).toBe("invalid");
    expect(outcome.diagnostics[0]?.message).toContain("Unknown target format");
  });

  it("applies a custom root name and ignores a blank one", () => {
    expect(runTransform(SAMPLE, "typescript", {}, "Payload").types[0]).toBe(
      "Payload",
    );

    expect(runTransform(SAMPLE, "typescript", {}, "   ").types[0]).toBe("Root");
  });

  it("emits one file per type for file-per-type targets", () => {
    const outcome = runTransform(SAMPLE, "java");

    expect(outcome.files.map((file) => file.path).sort()).toEqual([
      "Address.java",
      "OrdersItem.java",
      "Root.java",
    ]);
  });

  it("drives every registered target from an input of its own family", () => {
    for (const source of availableSources()) {
      const input = INPUT_FOR[source.id];

      expect(input, `no fixture for source ${source.id}`).toBeDefined();

      for (const target of targetsForSource(source.id)) {
        const outcome = runTransform(
          input as string,
          target.id,
          {},
          undefined,
          source.id,
        );

        expect(outcome.status, `${source.id} -> ${target.id}`).toBe("ok");
        expect(outcome.files.length).toBeGreaterThan(0);
        expect(outcome.preview.length).toBeGreaterThan(0);
      }
    }
  });

  it("transforms SQL into a diagram", () => {
    const outcome = runTransform(SQL_SAMPLE, "mermaid", {}, undefined, "sql");

    expect(outcome.status).toBe("ok");
    expect(outcome.types).toEqual(["users", "orders"]);
    expect(outcome.preview).toContain("erDiagram");
    expect(outcome.preview).toContain("users ||--o{ orders");
  });

  it("reports a cross-family pairing as a diagnostic, not a crash", () => {
    const outcome = runTransform(SAMPLE, "mermaid", {}, undefined, "json");

    expect(outcome.status).toBe("invalid");
    expect(outcome.diagnostics[0]?.message).toContain("cannot read");
  });
});

describe("source and target pairing", () => {
  it("lists both sources with a file-picker accept list", () => {
    expect(availableSources().map((source) => source.id)).toEqual([
      "json",
      "sql",
    ]);

    expect(availableSources()[1]?.accept).toBe(".sql,.ddl");
  });

  it("offers only compatible targets for each source", () => {
    expect(targetsForSource("json").map((t) => t.id)).toEqual([
      "typescript",
      "java",
      "go",
      "python",
      "csharp",
    ]);

    expect(targetsForSource("sql").map((t) => t.id)).toEqual([
      "mermaid",
      "dbml",
    ]);
  });
});

describe("validateInput", () => {
  it("is quiet for empty and valid input", () => {
    expect(validateInput("")).toEqual([]);
    expect(validateInput(SAMPLE)).toEqual([]);
  });

  it("locates a syntax error", () => {
    const diagnostics = validateInput('{\n  "a": 1,\n}');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("json/invalid-syntax");
  });
});

describe("buildGeneratorOptions", () => {
  it("only passes options the target understands", () => {
    const state = { ...DEFAULT_OPTIONS, packageName: "com.example" };

    // TypeScript has no package concept, so it must not receive one.
    expect(buildGeneratorOptions("typescript", state)).not.toHaveProperty(
      "packageName",
    );

    expect(buildGeneratorOptions("java", state)).toMatchObject({
      packageName: "com.example",
    });
  });

  it("omits blank text values rather than sending empty strings", () => {
    const options = buildGeneratorOptions("java", {
      ...DEFAULT_OPTIONS,
      packageName: "   ",
      style: "",
    });

    expect(options).not.toHaveProperty("packageName");
    expect(options).not.toHaveProperty("style");
  });

  it("maps the indent choice onto real whitespace", () => {
    const of = (indent: string) =>
      buildGeneratorOptions("typescript", { ...DEFAULT_OPTIONS, indent });

    expect(of("2")).toMatchObject({ indent: "  " });
    expect(of("4")).toMatchObject({ indent: "    " });
    expect(of("tab")).toMatchObject({ indent: "\t" });
    expect(of("default")).not.toHaveProperty("indent");
  });

  it("passes target specific switches through to their generator", () => {
    const state = { ...DEFAULT_OPTIONS, accessors: false, useRequired: false };

    expect(buildGeneratorOptions("java", state)).toMatchObject({
      accessors: false,
    });
    expect(buildGeneratorOptions("csharp", state)).toMatchObject({
      useRequired: false,
    });
    expect(buildGeneratorOptions("go", state)).not.toHaveProperty("accessors");
  });

  it("produces options every generator accepts end to end", () => {
    for (const source of availableSources()) {
      for (const target of targetsForSource(source.id)) {
        const descriptor = TARGETS[target.id];

        const options = buildGeneratorOptions(target.id, {
          ...DEFAULT_OPTIONS,
          packageName: "Example.Pkg",
          style: descriptor?.styles?.[1]?.value ?? "",
          indent: "4",
          header: true,
        });

        const outcome = runTransform(
          INPUT_FOR[source.id] as string,
          target.id,
          options,
          undefined,
          source.id,
        );

        expect(outcome.status, `${target.id} failed`).toBe("ok");
      }
    }
  });

  it("covers every registered target with a descriptor", () => {
    const registered = availableTargets().map((target) => target.id).sort();

    expect(Object.keys(TARGETS).sort()).toEqual(registered);
  });
});
