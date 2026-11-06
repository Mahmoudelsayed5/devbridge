import { allPropertiesOf, ancestorsOf } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseOpenApiSchemas } from "../index.js";

const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

const typeNamed = (result: ReturnType<typeof parse>, name: string) => {
  const type = result.context.getType(name);

  if (type === undefined) {
    throw new Error(
      `no type "${name}"; have ${result.context
        .getTypes()
        .map((t) => t.name)
        .join(", ")}`,
    );
  }

  return type;
};

const lookupIn = (result: ReturnType<typeof parse>) => (name: string) =>
  result.context.getType(name);

const PETS = `
    Pet:
      type: object
      required: [petType, name]
      properties:
        petType: { type: string }
        name: { type: string }
    Cat:
      allOf:
        - $ref: "#/components/schemas/Pet"
        - type: object
          required: [meowVolume]
          properties:
            meowVolume: { type: integer }
`;

describe("inheritance from allOf", () => {
  it("reads an allOf with a $ref as a base type", () => {
    const result = parse(PETS);

    expect(typeNamed(result, "Cat").extends).toBe("Pet");
    expect(typeNamed(result, "Pet").extends).toBeUndefined();
  });

  it("leaves the base's properties on the base", () => {
    const result = parse(PETS);

    // Flattening would copy petType and name into every subtype.
    expect(typeNamed(result, "Cat").properties.map((p) => p.name)).toEqual([
      "meowVolume",
    ]);

    expect(typeNamed(result, "Pet").properties.map((p) => p.name)).toEqual([
      "petType",
      "name",
    ]);
  });

  it("offers the flattened view for targets that need it", () => {
    const result = parse(PETS);

    expect(
      allPropertiesOf(typeNamed(result, "Cat"), lookupIn(result)).map(
        (p) => p.name,
      ),
    ).toEqual(["petType", "name", "meowVolume"]);
  });

  it("walks a chain more than one level deep", () => {
    const result = parse(`${PETS}
    ShowCat:
      allOf:
        - $ref: "#/components/schemas/Cat"
        - type: object
          properties:
            title: { type: string }
`);

    const showCat = typeNamed(result, "ShowCat");

    expect(ancestorsOf(showCat, lookupIn(result)).map((t) => t.name)).toEqual([
      "Cat",
      "Pet",
    ]);

    expect(allPropertiesOf(showCat, lookupIn(result)).map((p) => p.name)).toEqual(
      ["petType", "name", "meowVolume", "title"],
    );
  });

  it("merges inline branches into the subtype's own properties", () => {
    const result = parse(`
    Base:
      type: object
      properties: { id: { type: integer } }
    Thing:
      allOf:
        - $ref: "#/components/schemas/Base"
        - type: object
          properties: { a: { type: string } }
        - type: object
          properties: { b: { type: string } }
`);

    // Only the $ref is a base; the inline branches are this type's own.
    expect(typeNamed(result, "Thing").extends).toBe("Base");
    expect(typeNamed(result, "Thing").properties.map((p) => p.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("does not treat a non-object ref as a base", () => {
    const result = parse(`
    Email: { type: string }
    Thing:
      allOf:
        - $ref: "#/components/schemas/Email"
        - type: object
          properties: { a: { type: string } }
`);

    expect(typeNamed(result, "Thing").extends).toBeUndefined();
  });

  it("keeps an allOf of only inline branches flattened", () => {
    const result = parse(`
    Thing:
      allOf:
        - type: object
          properties: { a: { type: string } }
        - type: object
          properties: { b: { type: string } }
`);

    // An inline branch has no name, so there is nothing to extend.
    expect(typeNamed(result, "Thing").extends).toBeUndefined();
    expect(typeNamed(result, "Thing").properties.map((p) => p.name)).toEqual([
      "a",
      "b",
    ]);
  });

  describe("what one base cannot hold", () => {
    it("takes the first of several bases and reports the rest", () => {
      const result = parse(`
    A:
      type: object
      properties: { a: { type: string } }
    B:
      type: object
      properties: { b: { type: string } }
    Both:
      allOf:
        - $ref: "#/components/schemas/A"
        - $ref: "#/components/schemas/B"
`);

      const both = typeNamed(result, "Both");

      expect(both.extends).toBe("A");
      // B is merged in, since Java and C# have one base apiece.
      expect(both.properties.map((p) => p.name)).toEqual(["b"]);

      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/multiple-bases",
      );
    });

    it("drops a property a subtype redeclares with the same type", () => {
      const result = parse(`
    Base:
      type: object
      properties: { id: { type: integer } }
    Sub:
      allOf:
        - $ref: "#/components/schemas/Base"
        - type: object
          properties: { id: { type: integer } }
`);

      // Emitting it twice would not compile in Java or C#.
      expect(typeNamed(result, "Sub").properties).toEqual([]);
      expect(result.diagnostics.map((d) => d.code)).not.toContain(
        "openapi/narrowed-inherited-property",
      );
    });

    it("reports a redeclaration that changes the type", () => {
      const result = parse(`
    Base:
      type: object
      properties: { id: { type: integer } }
    Sub:
      allOf:
        - $ref: "#/components/schemas/Base"
        - type: object
          properties: { id: { type: string } }
`);

      expect(typeNamed(result, "Sub").properties).toEqual([]);
      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/narrowed-inherited-property",
      );
    });

    it("breaks a cycle rather than looping forever", () => {
      const result = parse(`
    A:
      allOf:
        - $ref: "#/components/schemas/B"
        - type: object
          properties: { a: { type: string } }
    B:
      allOf:
        - $ref: "#/components/schemas/A"
        - type: object
          properties: { b: { type: string } }
`);

      const chain = [
        typeNamed(result, "A").extends,
        typeNamed(result, "B").extends,
      ].filter((name) => name !== undefined);

      // One link survives; the one that closes the loop is dropped.
      expect(chain).toHaveLength(1);
      expect(result.diagnostics.map((d) => d.code)).toContain(
        "openapi/inheritance-cycle",
      );
    });
  });

  it("does not warn when the discriminator tag is inherited", () => {
    const result = parse(`${PETS}
    Shelter:
      type: object
      properties:
        resident:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
          discriminator:
            propertyName: petType
`);

    // petType lives on Pet, which is the ordinary shape of this idiom.
    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      "openapi/discriminator-property-missing",
    );
  });
});
