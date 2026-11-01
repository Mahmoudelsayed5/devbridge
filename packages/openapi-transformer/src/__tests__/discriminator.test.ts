import type { ObjectNode, UnionNode } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseOpenApiSchemas } from "../index.js";

const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

/** Cat and Dog, each declaring the tag property the discriminator needs. */
const BRANCHES = `
    Cat:
      type: object
      required: [petType]
      properties:
        petType: { type: string }
        meowVolume: { type: integer }
    Dog:
      type: object
      required: [petType]
      properties:
        petType: { type: string }
        breed: { type: string }
`;

const unionOf = (result: ReturnType<typeof parse>): UnionNode =>
  result.context.getType("Shelter")?.properties[0]?.value as UnionNode;

const tagOf = (result: ReturnType<typeof parse>, typeName: string) =>
  result.context
    .getType(typeName)
    ?.properties.find((p) => p.name === "petType");

describe("discriminated unions", () => {
  it("reads an explicit mapping", () => {
    const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
            mapping:
              cat: "#/components/schemas/Cat"
              dog: "#/components/schemas/Dog"
`);

    expect(unionOf(result).discriminator).toEqual({
      propertyName: "petType",
      mapping: [
        { value: "cat", typeName: "Cat" },
        { value: "dog", typeName: "Dog" },
      ],
    });
  });

  it("applies the implicit rule when there is no mapping", () => {
    const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
`);

    // With no mapping the tag value is each branch's own schema name.
    expect(unionOf(result).discriminator?.mapping).toEqual([
      { value: "Cat", typeName: "Cat" },
      { value: "Dog", typeName: "Dog" },
    ]);
  });

  it("narrows each branch's tag to the literal it must be", () => {
    const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
            mapping:
              cat: "#/components/schemas/Cat"
              dog: "#/components/schemas/Dog"
`);

    // This is what makes the union narrow in a switch.
    expect(tagOf(result, "Cat")?.value).toEqual({ kind: "literal", value: "cat" });
    expect(tagOf(result, "Dog")?.value).toEqual({ kind: "literal", value: "dog" });
  });

  it("marks the tag required, since it identifies the branch", () => {
    const result = parse(`
    Cat:
      type: object
      properties:
        petType: { type: string }
    Dog:
      type: object
      properties:
        petType: { type: string }
        breed: { type: string }
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
`);

    // Declared optional above, but a branch without its tag is unidentifiable.
    expect(tagOf(result, "Cat")?.optional).toBe(false);
  });

  it("narrows the branch wherever it is used, not only inside the union", () => {
    const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
            mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" }
    Adoption:
      type: object
      properties:
        cat: { $ref: "#/components/schemas/Cat" }
`);

    const direct = result.context
      .getType("Adoption")
      ?.properties[0]?.value as ObjectNode;

    // Same node: the discriminator asserts a Cat's tag is always "cat", so
    // the narrowing is sound everywhere Cat appears.
    expect(direct).toBe(result.context.getType("Cat"));
    expect(tagOf(result, "Cat")?.value).toMatchObject({ kind: "literal" });
  });

  it("leaves an undiscriminated union alone", () => {
    const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
`);

    expect(unionOf(result).discriminator).toBeUndefined();
    expect(tagOf(result, "Cat")?.value).toMatchObject({ type: "string" });
  });

  describe("documents that do not hold up", () => {
    it("warns when the discriminator names no property", () => {
      const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator: {}
`);

      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/discriminator-without-property",
      );

      expect(unionOf(result).discriminator).toBeUndefined();
    });

    it("warns when a mapping points at a schema that is not there", () => {
      const result = parse(`${BRANCHES}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
            mapping:
              cat: "#/components/schemas/Cat"
              bird: "#/components/schemas/Bird"
`);

      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/discriminator-unknown-target",
      );

      // The resolvable half still works.
      expect(unionOf(result).discriminator?.mapping).toEqual([
        { value: "cat", typeName: "Cat" },
      ]);
    });

    it("warns when the branches are inline rather than references", () => {
      const result = parse(`
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - type: object
              properties: { petType: { type: string } }
            - type: object
              properties: { petType: { type: string }, breed: { type: string } }
          discriminator:
            propertyName: petType
`);

      // An inline schema has no name for a tag value to select.
      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/discriminator-unresolved",
      );
    });

    it("warns when a branch does not declare the tag property", () => {
      const result = parse(`
    Cat:
      type: object
      properties:
        meowVolume: { type: integer }
    Dog:
      type: object
      required: [petType]
      properties:
        petType: { type: string }
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
          discriminator:
            propertyName: petType
`);

      const warning = result.diagnostics.find(
        (d) => d.code === "openapi/discriminator-property-missing",
      );

      expect(warning?.message).toContain("Cat");

      // The branch that does declare it is still narrowed.
      expect(tagOf(result, "Dog")?.value).toMatchObject({ kind: "literal" });
    });
  });
});
