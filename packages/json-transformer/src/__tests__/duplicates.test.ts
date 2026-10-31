import { describe, expect, it } from "vitest";

import {
  duplicateKeyDiagnostics,
  findDuplicateKeys,
  parseJson,
  validateJson,
} from "../index.js";

const keys = (text: string): string[] =>
  findDuplicateKeys(text).map((duplicate) => duplicate.key);

describe("findDuplicateKeys", () => {
  it("finds a repeated key in the same object", () => {
    expect(keys('{"id": 1, "id": 2}')).toEqual(["id"]);
  });

  it("reports each extra occurrence", () => {
    expect(keys('{"a": 1, "a": 2, "a": 3}')).toEqual(["a", "a"]);
  });

  it("is quiet for a document with none", () => {
    expect(keys('{"a": 1, "b": 2, "c": {"a": 3}}')).toEqual([]);
  });

  it("scopes keys to their own object", () => {
    // Two different objects may each have an "id"; that is not a duplicate.
    expect(keys('{"one": {"id": 1}, "two": {"id": 2}}')).toEqual([]);
  });

  it("finds duplicates nested inside objects and arrays", () => {
    expect(keys('{"outer": {"x": 1, "x": 2}}')).toEqual(["x"]);
    expect(keys('{"rows": [{"y": 1, "y": 2}]}')).toEqual(["y"]);
    expect(keys('[{"z": 1, "z": 2}]')).toEqual(["z"]);
  });

  it("does not mistake a string value for a key", () => {
    // "id" appears as a value twice; neither occurrence is a key.
    expect(keys('{"a": "id", "b": "id"}')).toEqual([]);
  });

  it("does not mistake an array of strings for keys", () => {
    expect(keys('{"tags": ["a", "a", "a"]}')).toEqual([]);
  });

  it("does not mistake a brace inside a string for structure", () => {
    expect(keys('{"a": "{\\"id\\": 1, \\"id\\": 2}", "b": 1}')).toEqual([]);
  });

  it("handles an escaped quote in a key", () => {
    expect(keys('{"a\\"b": 1, "a\\"b": 2}')).toEqual(['a"b']);
  });

  it("treats an escaped unicode key as equal to its literal form", () => {
    expect(keys('{"\\u0061": 1, "a": 2}')).toEqual(["a"]);
  });

  it("handles keys containing colons, commas and braces", () => {
    expect(keys('{"a:b,c{d": 1, "a:b,c{d": 2}')).toEqual(["a:b,c{d"]);
  });

  it("copes with an empty object and array", () => {
    expect(keys("{}")).toEqual([]);
    expect(keys("[]")).toEqual([]);
    expect(keys('{"a": {}, "b": []}')).toEqual([]);
  });
});

describe("duplicateKeyDiagnostics", () => {
  it("locates the surviving occurrence", () => {
    const [diagnostic] = duplicateKeyDiagnostics('{\n  "id": 1,\n  "id": 2\n}');

    expect(diagnostic).toMatchObject({
      severity: "warning",
      code: "json/duplicate-key",
      line: 3,
      column: 3,
    });

    expect(diagnostic?.message).toContain('"id"');
    expect(diagnostic?.message).toContain("last value");
  });
});

describe("integration with the parser", () => {
  it("warns through parseJson without rejecting the document", () => {
    const { root, diagnostics } = parseJson('{"id": 1, "id": 2}');

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "json/duplicate-key",
    );

    // The document still parses: the surviving value is what gets typed.
    expect(root.properties.map((property) => property.name)).toEqual(["id"]);
  });

  it("warns through validateJson", () => {
    expect(validateJson('{"a": 1, "a": 2}').map((d) => d.code)).toEqual([
      "json/duplicate-key",
    ]);
  });

  it("warns for a duplicate inside a root array", () => {
    expect(validateJson('[{"a": 1, "a": 2}]').map((d) => d.code)).toEqual([
      "json/duplicate-key",
    ]);
  });

  it("stays quiet for a clean document", () => {
    expect(validateJson('{"a": 1, "b": {"a": 2}}')).toEqual([]);
  });
});
