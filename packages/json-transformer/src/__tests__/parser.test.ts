import { describe, expect, it } from "vitest";

import type { ObjectNode, TypeNode } from "@devbridge/core";

import { parseJson, validateJson } from "../index.js";

function propertyOf(object: ObjectNode, name: string): TypeNode | undefined {
  return object.properties.find((property) => property.name === name)?.value;
}

describe("parseJson", () => {
  it("parses a nested JSON object into named types", () => {
    const input = JSON.stringify({
      user: {
        id: 10,
        name: "Mahmoud",
      },
    });

    const result = parseJson(input);

    expect(result.root.name).toBe("Root");

    const userProperty = result.root.properties.find(
      (property) => property.name === "user",
    );

    expect(userProperty).toBeDefined();
    expect(userProperty?.value.kind).toBe("object");

    expect(result.context.getType("Root")).toBeDefined();
    expect(result.context.getType("User")).toBeDefined();

    const user = result.context.getType("User");

    expect(user?.properties).toHaveLength(2);
    expect(user?.properties[0]?.name).toBe("id");
    expect(user?.properties[0]?.value).toEqual({
      kind: "primitive",
      type: "integer",
    });

    expect(user?.properties[1]?.name).toBe("name");
    expect(user?.properties[1]?.value).toEqual({
      kind: "primitive",
      type: "string",
    });
  });

  it("registers the root type first", () => {
    const { context } = parseJson(
      JSON.stringify({ user: { profile: { city: "Cairo" } } }),
    );

    expect(context.getTypes().map((type) => type.name)).toEqual([
      "Root",
      "User",
      "Profile",
    ]);
  });

  it("honours a custom root name", () => {
    const { root } = parseJson(JSON.stringify({ id: 1 }), {
      rootName: "api_response",
    });

    expect(root.name).toBe("ApiResponse");
  });

  it("rejects non-object JSON roots", () => {
    expect(() => parseJson('"hello"')).toThrow("JSON root must be an object");
    expect(() => parseJson("42")).toThrow("JSON root must be an object");
    expect(() => parseJson("null")).toThrow("JSON root must be an object");
  });

  it("reports the position of a syntax error", () => {
    const diagnostics = validateJson('{\n  "a": 1,\n}');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("json/invalid-syntax");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.line).toBeGreaterThanOrEqual(1);
  });

  it("reports empty input", () => {
    expect(validateJson("   ")).toEqual([
      expect.objectContaining({ code: "json/empty-input" }),
    ]);

    expect(() => parseJson("")).toThrow("The input is empty.");
  });

  it("accepts a valid document", () => {
    expect(validateJson('{"a":1}')).toEqual([]);
  });

  it("tolerates a UTF-8 byte order mark", () => {
    const withBom = `﻿{"id":1}`;

    expect(validateJson(withBom)).toEqual([]);

    const { root } = parseJson(withBom);

    expect(root.properties.map((property) => property.name)).toEqual(["id"]);
  });

  it("describes one element when the root is an array of objects", () => {
    const { root, diagnostics } = parseJson(
      JSON.stringify([{ id: 1 }, { id: 2, label: "x" }]),
    );

    expect(root.name).toBe("Root");
    expect(propertyOf(root, "id")).toEqual({
      kind: "primitive",
      type: "integer",
    });

    expect(
      root.properties.find((property) => property.name === "label")?.optional,
    ).toBe(true);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "json/array-root",
    );
  });

  it("rejects a root array with nothing to describe", () => {
    expect(() => parseJson("[]")).toThrow("at least one object");
    expect(() => parseJson("[1, 2]")).toThrow("at least one object");
  });

  it("rejects a root array when asked to", () => {
    expect(() => parseJson("[{}]", { arrayRoot: "error" })).toThrow(
      "JSON root must be an object",
    );
  });

  it("creates unique names for nested objects with the same property name", () => {
    const input = JSON.stringify({
      company: {
        address: {
          city: "Cairo",
        },
      },
      customer: {
        address: {
          city: "Alexandria",
        },
      },
    });

    const { context } = parseJson(input);

    const names = context.getTypes().map((type) => type.name);

    expect(names).toContain("Company");
    expect(names).toContain("Customer");
    expect(names).toContain("CompanyAddress");
    expect(names).toContain("CustomerAddress");

    expect(names).not.toContain("Address");
  });

  it("keeps deeply nested same-named objects apart", () => {
    const input = JSON.stringify({
      one: { group: { item: { a: 1 } } },
      two: { group: { item: { b: 2 } } },
    });

    const { context } = parseJson(input);
    const names = context.getTypes().map((type) => type.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("OneGroupItem");
    expect(names).toContain("TwoGroupItem");

    expect(context.getType("OneGroupItem")?.properties.map((p) => p.name)).toEqual([
      "a",
    ]);
    expect(context.getType("TwoGroupItem")?.properties.map((p) => p.name)).toEqual([
      "b",
    ]);
  });

  it("uses the shortest unique name when there is no conflict", () => {
    const { context } = parseJson(
      JSON.stringify({ users: [{ profile: { city: "Cairo" } }] }),
    );

    const names = context.getTypes().map((type) => type.name);

    expect(names).toEqual(["Root", "UsersItem", "Profile"]);
  });

  it("distinguishes integer and decimal values", () => {
    const { root } = parseJson(
      JSON.stringify({
        age: 25,
        price: 19.99,
      }),
    );

    expect(propertyOf(root, "age")).toEqual({
      kind: "primitive",
      type: "integer",
    });

    expect(propertyOf(root, "price")).toEqual({
      kind: "primitive",
      type: "number",
    });
  });

  it("widens integer and decimal samples into one number type", () => {
    const { root } = parseJson(JSON.stringify({ values: [1, 2.5] }));

    expect(propertyOf(root, "values")).toEqual({
      kind: "array",
      elementType: { kind: "primitive", type: "number" },
    });
  });

  it("merges nested objects across array items", () => {
    const input = JSON.stringify({
      users: [
        { profile: { city: "Cairo" } },
        { profile: { city: "Giza", zip: 123 } },
      ],
    });

    const { context } = parseJson(input);

    const profile = context.getType("Profile");

    expect(profile?.properties.map((property) => property.name)).toEqual([
      "city",
      "zip",
    ]);

    expect(
      profile?.properties.find((property) => property.name === "zip")?.optional,
    ).toBe(true);

    expect(
      profile?.properties.find((property) => property.name === "city")?.optional,
    ).toBe(false);
  });

  it("collapses an empty array with a populated one", () => {
    const input = JSON.stringify({
      users: [{ tags: [] }, { tags: ["a"] }],
    });

    const { context } = parseJson(input);

    expect(propertyOf(context.getType("UsersItem") as ObjectNode, "tags")).toEqual({
      kind: "array",
      elementType: { kind: "primitive", type: "string" },
    });
  });

  it("keeps an empty array as unknown when nothing else is observed", () => {
    const { root } = parseJson(JSON.stringify({ users: [] }));

    expect(propertyOf(root, "users")).toEqual({
      kind: "array",
      elementType: { kind: "primitive", type: "unknown" },
    });
  });

  it("unions mixed array element types in document order", () => {
    const { root } = parseJson(JSON.stringify({ values: [10, "a", true] }));

    expect(propertyOf(root, "values")).toEqual({
      kind: "array",
      elementType: {
        kind: "union",
        types: [
          { kind: "primitive", type: "integer" },
          { kind: "primitive", type: "string" },
          { kind: "primitive", type: "boolean" },
        ],
      },
    });
  });

  it("merges objects inside mixed arrays into one item type", () => {
    const input = JSON.stringify({
      items: [{ a: 1 }, "text", { b: 2 }],
    });

    const { root, context } = parseJson(input);

    const items = propertyOf(root, "items");

    expect(items?.kind).toBe("array");

    const itemsItem = context.getType("ItemsItem");

    expect(itemsItem?.properties.map((property) => property.name)).toEqual([
      "a",
      "b",
    ]);

    expect(
      itemsItem?.properties.every((property) => property.optional),
    ).toBe(true);
  });

  it("treats a null sample as a nullable union, not an optional property", () => {
    const input = JSON.stringify({
      users: [
        { name: "Mahmoud", age: 25 },
        { name: "Ahmed", age: null },
      ],
    });

    const { context } = parseJson(input);

    const age = context
      .getType("UsersItem")
      ?.properties.find((property) => property.name === "age");

    expect(age?.optional).toBe(false);
    expect(age?.value).toEqual({
      kind: "union",
      types: [
        { kind: "primitive", type: "integer" },
        { kind: "primitive", type: "null" },
      ],
    });
  });

  it("supports arrays of arrays", () => {
    const { root } = parseJson(JSON.stringify({ matrix: [[1, 2], [3]] }));

    expect(propertyOf(root, "matrix")).toEqual({
      kind: "array",
      elementType: {
        kind: "array",
        elementType: { kind: "primitive", type: "integer" },
      },
    });
  });

  it("keeps source property names untouched", () => {
    const { root } = parseJson(JSON.stringify({ "user-name": "x", "2fa": true }));

    expect(root.properties.map((property) => property.name)).toEqual([
      "user-name",
      "2fa",
    ]);
  });
});
