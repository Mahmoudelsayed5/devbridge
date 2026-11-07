import { tagFor } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseOpenApiSchemas } from "../index.js";

const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

const typeNamed = (result: ReturnType<typeof parse>, name: string) => {
  const type = result.context.getType(name);

  if (type === undefined) {
    throw new Error(`no type "${name}"`);
  }

  return type;
};

const tagOf = (result: ReturnType<typeof parse>, name: string) =>
  tagFor(
    typeNamed(result, name),
    (lookupName) => result.context.getType(lookupName),
    result.context.getTypes(),
  );

/** Pet as a polymorphic base, with two subtypes. */
const PETS = (discriminator: string) => `
    Pet:
      type: object
      required: [petType]
      properties:
        petType: { type: string }
${discriminator}
    Cat:
      allOf:
        - $ref: "#/components/schemas/Pet"
        - type: object
          properties: { meowVolume: { type: integer } }
    Dog:
      allOf:
        - $ref: "#/components/schemas/Pet"
        - type: object
          properties: { breed: { type: string } }
`;

describe("a discriminator on a base schema", () => {
  it("records the base as polymorphic, with an explicit mapping", () => {
    const result = parse(
      PETS(`      discriminator:
        propertyName: petType
        mapping:
          cat: "#/components/schemas/Cat"
          dog: "#/components/schemas/Dog"`),
    );

    expect(typeNamed(result, "Pet").discriminator).toEqual({
      propertyName: "petType",
      mapping: [
        { value: "cat", typeName: "Cat" },
        { value: "dog", typeName: "Dog" },
      ],
    });
  });

  it("finds its subtypes implicitly when there is no mapping", () => {
    const result = parse(
      PETS(`      discriminator:
        propertyName: petType`),
    );

    // The implicit rule: everything that extends the base, tagged with its
    // own schema name.
    expect(typeNamed(result, "Pet").discriminator?.mapping).toEqual([
      { value: "Cat", typeName: "Cat" },
      { value: "Dog", typeName: "Dog" },
    ]);
  });

  it("leaves subtypes without a discriminator of their own", () => {
    const result = parse(
      PETS(`      discriminator:
        propertyName: petType`),
    );

    expect(typeNamed(result, "Cat").discriminator).toBeUndefined();
  });

  it("gives each subtype the tag that selects it", () => {
    const result = parse(
      PETS(`      discriminator:
        propertyName: petType
        mapping:
          cat: "#/components/schemas/Cat"
          dog: "#/components/schemas/Dog"`),
    );

    expect(tagOf(result, "Cat")).toEqual({
      propertyName: "petType",
      values: ["cat"],
    });

    expect(tagOf(result, "Dog")?.values).toEqual(["dog"]);
  });

  it("warns when nothing extends the base", () => {
    const result = parse(`
    Lonely:
      type: object
      required: [kind]
      properties:
        kind: { type: string }
      discriminator:
        propertyName: kind
    User:
      type: object
      properties: { a: { type: string } }
`);

    expect(result.diagnostics.map((d) => d.code)).toContain(
      "openapi/discriminator-no-subtypes",
    );

    expect(typeNamed(result, "Lonely").discriminator).toBeUndefined();
  });

  it("warns when a mapping names a schema that is not there", () => {
    const result = parse(
      PETS(`      discriminator:
        propertyName: petType
        mapping:
          cat: "#/components/schemas/Cat"
          bird: "#/components/schemas/Bird"`),
    );

    expect(result.diagnostics.map((d) => d.code)).toContain(
      "openapi/discriminator-unknown-target",
    );

    expect(typeNamed(result, "Pet").discriminator?.mapping).toEqual([
      { value: "cat", typeName: "Cat" },
    ]);
  });
});

describe("a tag in a hierarchy deeper than two", () => {
  const DEEP = `
    Vehicle:
      type: object
      required: [kind]
      properties:
        kind: { type: string }
      discriminator:
        propertyName: kind
        mapping:
          truck: "#/components/schemas/Truck"
          tipper: "#/components/schemas/TipperTruck"
    Truck:
      allOf:
        - $ref: "#/components/schemas/Vehicle"
        - type: object
          properties: { axles: { type: integer } }
    TipperTruck:
      allOf:
        - $ref: "#/components/schemas/Truck"
        - type: object
          properties: { capacity: { type: integer } }
`;

  it("gives a non-leaf its own tag plus every descendant's", () => {
    const result = parse(DEEP);

    // A TipperTruck *is* a Truck and carries "tipper", so narrowing Truck to
    // just "truck" would be a lie — and TypeScript rejects it outright.
    expect(tagOf(result, "Truck")?.values).toEqual(["truck", "tipper"]);
  });

  it("collapses a leaf to the single value that identifies it", () => {
    const result = parse(DEEP);

    expect(tagOf(result, "TipperTruck")?.values).toEqual(["tipper"]);
  });

  it("leaves the base itself unnarrowed when nothing maps to it", () => {
    const result = parse(DEEP);

    expect(tagOf(result, "Vehicle")).toBeUndefined();
  });
});
