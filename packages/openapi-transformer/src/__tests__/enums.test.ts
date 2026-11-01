import type { EnumNode, UnionNode } from "@devbridge/core";
import { TransformationError } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseOpenApiSchemas } from "../index.js";

const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

const enumNamed = (
  result: ReturnType<typeof parse>,
  name: string,
): EnumNode => {
  const node = result.context.getEnum(name);

  if (node === undefined) {
    throw new Error(
      `no enum "${name}"; have ${result.context
        .getEnums()
        .map((e) => e.name)
        .join(", ")}`,
    );
  }

  return node;
};

const propertyType = (
  result: ReturnType<typeof parse>,
  typeName: string,
  property: string,
) =>
  result.context
    .getType(typeName)
    ?.properties.find((p) => p.name === property)?.value;

describe("enums from components/schemas", () => {
  it("turns a top-level enum schema into a named enum", () => {
    const result = parse(`
    Status:
      type: string
      enum: [available, pending, sold]
    Pet:
      type: object
      required: [status]
      properties:
        status: { $ref: "#/components/schemas/Status" }
`);

    const status = enumNamed(result, "Status");

    expect(status.baseType).toBe("string");
    expect(status.members.map((m) => m.value)).toEqual([
      "available",
      "pending",
      "sold",
    ]);

    // One enum, referenced — not copied into the property.
    expect(propertyType(result, "Pet", "status")).toBe(status);
  });

  it("keeps the schema's own name rather than allocating a second one", () => {
    const result = parse(`
    Status:
      type: string
      enum: [a, b]
    Pet:
      type: object
      properties: { status: { $ref: "#/components/schemas/Status" } }
`);

    expect(result.context.getEnums().map((e) => e.name)).toEqual(["Status"]);
  });

  it("names an inline enum after its parent and property", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        status: { type: string, enum: [available, sold] }
`);

    expect(result.context.getEnums().map((e) => e.name)).toEqual(["PetStatus"]);
  });

  it("prefers the enum over the declared scalar type", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        status: { type: string, enum: [a, b] }
`);

    // `type: string` with an `enum` is an enum; the closed set is the more
    // useful fact and the string is implied by it.
    expect(propertyType(result, "Pet", "status")).toMatchObject({
      kind: "enum",
    });
  });

  it("reads an integer enum", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        priority: { type: integer, enum: [1, 2, 3] }
`);

    const node = enumNamed(result, "PetPriority");

    expect(node.baseType).toBe("integer");
    expect(node.members.map((m) => m.value)).toEqual([1, 2, 3]);
  });

  it("reads an enum whose type is left implicit", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        status: { enum: [a, b] }
`);

    expect(enumNamed(result, "PetStatus").baseType).toBe("string");
  });

  it("does not report a top-level enum as an alias with no type", () => {
    const result = parse(`
    Status:
      type: string
      enum: [a, b]
    Pet:
      type: object
      properties: { status: { $ref: "#/components/schemas/Status" } }
`);

    // It *does* have a generated type of its own now.
    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      "openapi/alias-schema",
    );
  });

  describe("nullability", () => {
    it("treats a null member as nullable rather than as a value", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        status: { type: string, enum: [a, b, null] }
`);

      const status = propertyType(result, "Pet", "status") as UnionNode;

      expect(status.kind).toBe("union");
      expect(status.types.map((t) => t.kind)).toEqual(["enum", "primitive"]);
      expect(enumNamed(result, "PetStatus").members).toHaveLength(2);
    });

    it("reads the 3.0 nullable flag on an enum", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        status: { type: string, enum: [a, b], nullable: true }
`);

      expect(propertyType(result, "Pet", "status")).toMatchObject({
        kind: "union",
      });
    });
  });

  describe("values the IR cannot name directly", () => {
    it("keeps awkward values intact while shaping the names", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        grade: { type: string, enum: ["A+", "n/a", "2xx", "kebab-case"] }
`);

      const node = enumNamed(result, "PetGrade");

      expect(node.members.map((m) => m.value)).toEqual([
        "A+",
        "n/a",
        "2xx",
        "kebab-case",
      ]);

      // "n/a" splits into two words, so the neutral name is NA; each target
      // re-cases it from there (C# renders it `Na`, Java `NA`).
      expect(node.members.map((m) => m.name)).toEqual([
        "A",
        "NA",
        "Value3",
        "KebabCase",
      ]);
    });

    it("falls back to a plain value for a mixed-type enum", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        odd: { enum: [1, "two"] }
`);

      expect(result.context.getEnums()).toHaveLength(0);
      expect(propertyType(result, "Pet", "odd")).toMatchObject({
        kind: "primitive",
      });

      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/mixed-enum",
      );
    });

    it("ignores an empty enum list", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        status: { type: string, enum: [] }
`);

      expect(result.context.getEnums()).toHaveLength(0);
      expect(propertyType(result, "Pet", "status")).toMatchObject({
        type: "string",
      });
    });
  });

  it("refuses a document of nothing but enums, and says why", () => {
    // ParseResult.root is an ObjectNode, so there is nothing honest to
    // return for an enums-only file.
    expect(() =>
      parse(`
    Status: { type: string, enum: [a, b] }
    Tier: { type: string, enum: [x, y] }
`),
    ).toThrow(TransformationError);

    expect(() =>
      parse(`
    Status: { type: string, enum: [a, b] }
`),
    ).toThrow(/at least one object type/);
  });

  it("keeps an enum and an object from colliding on a name", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        pet: { type: string, enum: [a, b] }
`);

    // The inline enum wants "PetPet", not "Pet" — but either way the two
    // namespaces are allocated together, so nothing collides.
    const allNames = [
      ...result.context.getTypes().map((t) => t.name),
      ...result.context.getEnums().map((e) => e.name),
    ];

    expect(new Set(allNames).size).toBe(allNames.length);
  });
});
