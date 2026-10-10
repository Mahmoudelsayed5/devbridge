import { describe, expect, it } from "vitest";

import { TransformationError } from "@devbridge/core";

import {
  listSources,
  listTargets,
  sourceForFile,
  transform,
  validate,
} from "../index.js";

const SAMPLE = JSON.stringify({
  id: 1,
  user: { name: "Mahmoud", tags: ["java"] },
  orders: [{ total: 9.99 }, { total: 5, note: "gift" }],
});

describe("registries", () => {
  it("lists the formats the engine supports", () => {
    expect(listSources().map((format) => format.id)).toEqual(["json"]);

    expect(listTargets().map((format) => format.id)).toEqual([
      "typescript",
      "java",
      "go",
      "python",
      "csharp",
    ]);
  });

  it("resolves a source parser from a file name", () => {
    expect(sourceForFile("schema.JSON")?.id).toBe("json");
    expect(sourceForFile("schema.yaml")).toBeUndefined();
    expect(sourceForFile("schema")).toBeUndefined();
  });
});

describe("transform", () => {
  it("drives every generator from the same IR", () => {
    const targets = ["typescript", "java", "go", "python", "csharp"];

    for (const target of targets) {
      const result = transform({ input: SAMPLE, source: "json", target });

      expect(result.target).toBe(target);
      expect(result.types).toEqual(["Root", "User", "OrdersItem"]);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.preview.length).toBeGreaterThan(0);

      for (const file of result.files) {
        expect(file.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("passes options through to the parser and the generator", () => {
    const result = transform({
      input: SAMPLE,
      source: "json",
      target: "java",
      parseOptions: { rootName: "Payload" },
      generatorOptions: { packageName: "com.example" },
    });

    expect(result.root.name).toBe("Payload");
    expect(result.files.map((file) => file.path)).toContain("Payload.java");
    expect(result.preview).toContain("package com.example;");
  });

  it("reports an unknown source or target", () => {
    expect(() =>
      transform({ input: SAMPLE, source: "yaml", target: "java" }),
    ).toThrow(TransformationError);

    expect(() =>
      transform({ input: SAMPLE, source: "json", target: "rust" }),
    ).toThrow(/Unknown target format "rust"/);
  });

  it("surfaces parse diagnostics instead of silently succeeding", () => {
    expect(() =>
      transform({ input: "{ bad", source: "json", target: "typescript" }),
    ).toThrow(TransformationError);
  });
});

describe("validate", () => {
  it("returns no diagnostics for a valid artifact", () => {
    expect(validate(SAMPLE, "json")).toEqual([]);
  });

  it("returns a located diagnostic for a broken artifact", () => {
    const diagnostics = validate("{ bad", "json");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.code).toBe("json/invalid-syntax");
  });
});
