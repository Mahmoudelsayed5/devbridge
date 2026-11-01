import type { ArrayNode, MapNode, ObjectNode } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseOpenApiSchemas } from "../index.js";

const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

const propertyType = (
  result: ReturnType<typeof parse>,
  typeName: string,
  property: string,
) =>
  result.context
    .getType(typeName)
    ?.properties.find((p) => p.name === property)?.value;

/** A Doc schema with one property, for the common case. */
const withProperty = (body: string) =>
  parse(`
    Doc:
      type: object
      properties:
        field:
${body
  .split("\n")
  .map((line) => (line.length === 0 ? line : `          ${line}`))
  .join("\n")}
`);

describe("maps from additionalProperties", () => {
  it("reads a typed map", () => {
    const result = withProperty(`type: object
additionalProperties: { type: string }`);

    expect(propertyType(result, "Doc", "field")).toEqual({
      kind: "map",
      valueType: { kind: "primitive", type: "string" },
    });
  });

  it("carries the declared integer width into the value", () => {
    const result = withProperty(`type: object
additionalProperties: { type: integer, format: int64 }`);

    expect(propertyType(result, "Doc", "field")).toMatchObject({
      kind: "map",
      valueType: { type: "long" },
    });
  });

  it("reads a map of a referenced type", () => {
    const result = parse(`
    Tag:
      type: object
      properties: { label: { type: string } }
    Doc:
      type: object
      properties:
        field:
          type: object
          additionalProperties: { $ref: "#/components/schemas/Tag" }
`);

    const map = propertyType(result, "Doc", "field") as MapNode;

    expect(map.kind).toBe("map");
    expect(map.valueType).toBe(result.context.getType("Tag"));
  });

  it("reads a map of arrays", () => {
    const result = withProperty(`type: object
additionalProperties:
  type: array
  items: { type: string }`);

    const map = propertyType(result, "Doc", "field") as MapNode;
    const value = map.valueType as ArrayNode;

    expect(map.kind).toBe("map");
    expect(value.kind).toBe("array");
    expect(value.elementType).toMatchObject({ type: "string" });
  });

  it("names an inline object value after its parent", () => {
    const result = withProperty(`type: object
additionalProperties:
  type: object
  properties: { city: { type: string } }`);

    const map = propertyType(result, "Doc", "field") as MapNode;

    expect((map.valueType as ObjectNode).name).toBe("DocFieldValue");
  });

  describe("the three meanings of additionalProperties", () => {
    it("treats `true` as a map of anything", () => {
      const result = withProperty(`type: object
additionalProperties: true`);

      expect(propertyType(result, "Doc", "field")).toEqual({
        kind: "map",
        valueType: { kind: "primitive", type: "unknown" },
      });
    });

    it("treats an empty schema as a map of anything", () => {
      const result = withProperty(`type: object
additionalProperties: {}`);

      expect(propertyType(result, "Doc", "field")).toMatchObject({
        kind: "map",
        valueType: { type: "unknown" },
      });
    });

    it("treats `false` as a closed object, which is the opposite claim", () => {
      const result = withProperty(`type: object
additionalProperties: false`);

      // Not a map: `false` forbids extra keys rather than permitting them.
      expect(propertyType(result, "Doc", "field")).toMatchObject({
        kind: "primitive",
        type: "unknown",
      });

      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/free-form-object",
      );
    });
  });

  it("keeps declared properties and reports the dropped overflow", () => {
    const result = parse(`
    Doc:
      type: object
      properties:
        known: { type: string }
      additionalProperties: { type: string }
`);

    // No target has a type that is both a fixed set of fields and an open
    // map, so the named fields win and the rest is reported.
    expect(result.context.getType("Doc")?.properties.map((p) => p.name)).toEqual(
      ["known"],
    );

    const warning = result.diagnostics.find(
      (d) => d.code === "openapi/object-with-extras",
    );

    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("Doc");
  });

  it("does not warn about overflow when extra keys are forbidden", () => {
    const result = parse(`
    Doc:
      type: object
      properties:
        known: { type: string }
      additionalProperties: false
`);

    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      "openapi/object-with-extras",
    );
  });

  it("reads a nullable map", () => {
    const result = withProperty(`type: object
nullable: true
additionalProperties: { type: string }`);

    expect(propertyType(result, "Doc", "field")).toMatchObject({
      kind: "union",
      types: [{ kind: "map" }, { type: "null" }],
    });
  });

  it("reads a top-level map schema through a reference", () => {
    const result = parse(`
    Labels:
      type: object
      additionalProperties: { type: string }
    Doc:
      type: object
      properties:
        field: { $ref: "#/components/schemas/Labels" }
`);

    // A map is structural, so it inlines at the point of use rather than
    // becoming a declared type of its own.
    expect(result.context.getTypes().map((t) => t.name)).toEqual(["Doc"]);
    expect(propertyType(result, "Doc", "field")).toMatchObject({ kind: "map" });
  });
});
