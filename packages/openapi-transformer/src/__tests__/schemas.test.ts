import type { ArrayNode, ObjectNode, TypeNode, UnionNode } from "@devbridge/core";
import { TransformationError } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import {
  openApiParser,
  parseOpenApiSchemas,
  validateOpenApiSchemas,
} from "../index.js";

/** Wraps schema definitions in the smallest document that carries them. */
const doc = (schemas: string): string =>
  `openapi: 3.0.3\ninfo: { title: T, version: "1" }\ncomponents:\n  schemas:\n${schemas}`;

const parse = (schemas: string) => parseOpenApiSchemas(doc(schemas));

const typeNamed = (
  result: ReturnType<typeof parse>,
  name: string,
): ObjectNode => {
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

const propertyNamed = (object: ObjectNode, name: string) => {
  const property = object.properties.find((p) => p.name === name);

  if (property === undefined) {
    throw new Error(`no property "${name}" on ${object.name}`);
  }

  return property;
};

const typeOf = (object: ObjectNode, name: string): TypeNode =>
  propertyNamed(object, name).value;

describe("parseOpenApiSchemas", () => {
  it("turns each schema into a named type", () => {
    const result = parse(`
    Pet:
      type: object
      properties:
        name: { type: string }
    Owner:
      type: object
      properties:
        name: { type: string }
`);

    expect(result.context.getTypes().map((type) => type.name)).toEqual([
      "Pet",
      "Owner",
    ]);
  });

  it("names types from the schema key, not from where they are used", () => {
    const result = parse(`
    pet_record:
      type: object
      properties:
        id: { type: integer }
`);

    expect(result.context.getTypes().map((type) => type.name)).toEqual([
      "PetRecord",
    ]);
  });

  it("uses the first schema as the root", () => {
    const result = parse(`
    First:
      type: object
      properties: { a: { type: string } }
    Second:
      type: object
      properties: { b: { type: string } }
`);

    // Deliberately a real schema rather than a synthesised wrapper: every
    // generator emits each type in the context and uses the root for order.
    expect(result.root.name).toBe("First");
    expect(result.context.hasType(result.root.name)).toBe(true);
  });

  describe("scalar mapping", () => {
    it("reads the declared integer width rather than guessing it", () => {
      const result = parse(`
    Account:
      type: object
      properties:
        id: { type: integer, format: int64 }
        count: { type: integer, format: int32 }
        plain: { type: integer }
`);

      const account = typeNamed(result, "Account");

      // The whole point of reading OpenAPI instead of a sample: the document
      // states the width, so no inference from magnitude is involved.
      expect(typeOf(account, "id")).toMatchObject({ type: "long" });
      expect(typeOf(account, "count")).toMatchObject({ type: "integer" });
      expect(typeOf(account, "plain")).toMatchObject({ type: "integer" });
    });

    it("maps the remaining scalars", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        s: { type: string }
        n: { type: number }
        b: { type: boolean }
`);

      const row = typeNamed(result, "Row");

      expect(typeOf(row, "s")).toMatchObject({ type: "string" });
      expect(typeOf(row, "n")).toMatchObject({ type: "number" });
      expect(typeOf(row, "b")).toMatchObject({ type: "boolean" });
    });

    it("gives an enum a named enum type, not its base type", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        status: { enum: [open, closed] }
        code: { enum: [1, 2, 3] }
`);

      const row = typeNamed(result, "Row");

      // Enums are their own IR node; see enums.test.ts for the detail.
      expect(typeOf(row, "status")).toMatchObject({
        kind: "enum",
        baseType: "string",
      });

      expect(typeOf(row, "code")).toMatchObject({
        kind: "enum",
        baseType: "integer",
      });
    });

    it("falls back to unknown for a schema that declares nothing", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        anything: {}
`);

      expect(typeOf(typeNamed(result, "Row"), "anything")).toMatchObject({
        type: "unknown",
      });
    });
  });

  describe("required", () => {
    it("marks properties outside the required list optional", () => {
      const result = parse(`
    Pet:
      type: object
      required: [id]
      properties:
        id: { type: integer }
        nickname: { type: string }
`);

      const pet = typeNamed(result, "Pet");

      // Declared, not counted across samples the way JSON inference must.
      expect(propertyNamed(pet, "id").optional).toBe(false);
      expect(propertyNamed(pet, "nickname").optional).toBe(true);
    });

    it("treats a schema with no required list as all-optional", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        id: { type: integer }
`);

      expect(propertyNamed(typeNamed(result, "Pet"), "id").optional).toBe(true);
    });
  });

  describe("references", () => {
    it("resolves a $ref to the one named type, used twice", () => {
      const result = parse(`
    Customer:
      type: object
      properties: { id: { type: integer } }
    Order:
      type: object
      properties:
        buyer: { $ref: "#/components/schemas/Customer" }
    Invoice:
      type: object
      properties:
        payer: { $ref: "#/components/schemas/Customer" }
`);

      const customer = typeNamed(result, "Customer");

      // Inference from samples would have to decide whether these are the
      // same type; the document says they are.
      expect(typeOf(typeNamed(result, "Order"), "buyer")).toBe(customer);
      expect(typeOf(typeNamed(result, "Invoice"), "payer")).toBe(customer);
      expect(result.context.getTypes()).toHaveLength(3);
    });

    it("resolves a reference declared after its use", () => {
      const result = parse(`
    Order:
      type: object
      properties:
        buyer: { $ref: "#/components/schemas/Customer" }
    Customer:
      type: object
      properties: { id: { type: integer } }
`);

      expect(typeOf(typeNamed(result, "Order"), "buyer")).toMatchObject({
        kind: "object",
        name: "Customer",
      });
    });

    it("represents a self-referential schema", () => {
      const result = parse(`
    Node:
      type: object
      properties:
        label: { type: string }
        children:
          type: array
          items: { $ref: "#/components/schemas/Node" }
`);

      const node = typeNamed(result, "Node");
      const children = typeOf(node, "children") as ArrayNode;

      // A cycle is ordinary here because a $ref is a link by name. No set of
      // JSON samples can express this.
      expect(children.elementType).toBe(node);
      expect((children.elementType as ObjectNode).properties).toHaveLength(2);
    });

    it("represents a cycle between two schemas", () => {
      const result = parse(`
    Parent:
      type: object
      properties:
        child: { $ref: "#/components/schemas/Child" }
    Child:
      type: object
      properties:
        parent: { $ref: "#/components/schemas/Parent" }
`);

      const parent = typeNamed(result, "Parent");
      const child = typeNamed(result, "Child");

      expect(typeOf(parent, "child")).toBe(child);
      expect(typeOf(child, "parent")).toBe(parent);
    });

    it("inlines a reference to a schema that is not an object", () => {
      const result = parse(`
    Email:
      type: string
      format: email
    User:
      type: object
      properties:
        address: { $ref: "#/components/schemas/Email" }
`);

      // The IR has no type aliases, so Email is not a type of its own.
      expect(result.context.getTypes().map((t) => t.name)).toEqual(["User"]);
      expect(typeOf(typeNamed(result, "User"), "address")).toMatchObject({
        type: "string",
      });
    });

    it("reports the schemas that produced no type of their own", () => {
      const result = parse(`
    Email:
      type: string
    User:
      type: object
      properties: { address: { $ref: "#/components/schemas/Email" } }
`);

      const note = result.diagnostics.find(
        (diagnostic) => diagnostic.code === "openapi/alias-schema",
      );

      expect(note?.severity).toBe("info");
      expect(note?.message).toContain("Email");
    });

    it("survives a reference to a schema that does not exist", () => {
      const result = parse(`
    Order:
      type: object
      properties:
        buyer: { $ref: "#/components/schemas/Missing" }
`);

      expect(typeOf(typeNamed(result, "Order"), "buyer")).toMatchObject({
        type: "unknown",
      });
    });
  });

  describe("composition", () => {
    it("merges allOf branches into one type", () => {
      const result = parse(`
    Base:
      type: object
      required: [id]
      properties:
        id: { type: integer }
    Dog:
      allOf:
        - { $ref: "#/components/schemas/Base" }
        - type: object
          required: [breed]
          properties:
            breed: { type: string }
`);

      const dog = typeNamed(result, "Dog");

      // allOf is how 3.0 spells inheritance; an empty shell would be useless.
      expect(dog.properties.map((p) => p.name)).toEqual(["id", "breed"]);
      expect(propertyNamed(dog, "id").optional).toBe(false);
      expect(propertyNamed(dog, "breed").optional).toBe(false);
    });

    it("keeps a property the later allOf branch overrides", () => {
      const result = parse(`
    Thing:
      allOf:
        - type: object
          properties: { value: { type: string } }
        - type: object
          properties: { value: { type: integer } }
`);

      const thing = typeNamed(result, "Thing");

      expect(thing.properties).toHaveLength(1);
      expect(typeOf(thing, "value")).toMatchObject({ type: "integer" });
    });

    it("turns oneOf into a union", () => {
      const result = parse(`
    Cat:
      type: object
      properties: { meow: { type: boolean } }
    Dog:
      type: object
      properties: { bark: { type: boolean } }
    Pet:
      type: object
      properties:
        animal:
          oneOf:
            - { $ref: "#/components/schemas/Cat" }
            - { $ref: "#/components/schemas/Dog" }
`);

      const animal = typeOf(typeNamed(result, "Pet"), "animal") as UnionNode;

      expect(animal.kind).toBe("union");
      expect(animal.types.map((type) => (type as ObjectNode).name)).toEqual([
        "Cat",
        "Dog",
      ]);
    });

    it("collapses a union whose branches are the same type", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        value:
          anyOf:
            - { type: string }
            - { type: string }
`);

      expect(typeOf(typeNamed(result, "Row"), "value")).toMatchObject({
        kind: "primitive",
        type: "string",
      });
    });
  });

  describe("nullability", () => {
    it("reads the 3.0 nullable flag", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        note: { type: string, nullable: true }
`);

      expect(typeOf(typeNamed(result, "Row"), "note")).toMatchObject({
        kind: "union",
        types: [{ type: "string" }, { type: "null" }],
      });
    });

    it("reads the 3.1 type array", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        note: { type: [string, "null"] }
`);

      expect(typeOf(typeNamed(result, "Row"), "note")).toMatchObject({
        kind: "union",
        types: [{ type: "string" }, { type: "null" }],
      });
    });

    it("does not add null twice", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        note: { type: [string, "null"], nullable: true }
`);

      const note = typeOf(typeNamed(result, "Row"), "note") as UnionNode;

      expect(note.types).toHaveLength(2);
    });
  });

  describe("nested shapes", () => {
    it("names an inline object after its parent and property", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        address:
          type: object
          properties:
            city: { type: string }
`);

      expect(result.context.getTypes().map((t) => t.name)).toEqual([
        "Pet",
        "PetAddress",
      ]);

      expect(typeOf(typeNamed(result, "Pet"), "address")).toMatchObject({
        kind: "object",
        name: "PetAddress",
      });
    });

    it("names an inline array element with the Item suffix", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        tags:
          type: array
          items:
            type: object
            properties: { label: { type: string } }
`);

      expect(result.context.getTypes().map((t) => t.name)).toEqual([
        "Pet",
        "PetTagsItem",
      ]);
    });

    it("keeps two inline objects of the same name apart", () => {
      const result = parse(`
    Pet:
      type: object
      properties:
        address:
          type: object
          properties: { city: { type: string } }
    Owner:
      type: object
      properties:
        address:
          type: object
          properties: { street: { type: string } }
`);

      expect(result.context.getTypes().map((t) => t.name)).toEqual([
        "Pet",
        "Owner",
        "PetAddress",
        "OwnerAddress",
      ]);
    });

    it("reads an array of referenced objects", () => {
      const result = parse(`
    Tag:
      type: object
      properties: { label: { type: string } }
    Pet:
      type: object
      properties:
        tags:
          type: array
          items: { $ref: "#/components/schemas/Tag" }
`);

      const tags = typeOf(typeNamed(result, "Pet"), "tags") as ArrayNode;

      expect(tags.kind).toBe("array");
      expect(tags.elementType).toBe(typeNamed(result, "Tag"));
    });
  });

  describe("what the type graph cannot express", () => {
    it("reads a map as a map, with no diagnostic", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        labels:
          type: object
          additionalProperties: { type: string }
`);

      // Maps have their own IR node; see maps.test.ts for the detail.
      expect(typeOf(typeNamed(result, "Row"), "labels")).toMatchObject({
        kind: "map",
        valueType: { type: "string" },
      });

      expect(result.diagnostics).toEqual([]);
    });

    it("warns about a free-form object", () => {
      const result = parse(`
    Row:
      type: object
      properties:
        payload: { type: object }
`);

      expect(
        result.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain("openapi/free-form-object");
    });
  });

  describe("refusals", () => {
    it("refuses a document with no components/schemas", () => {
      const onlyPaths = `openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /pets:
    get:
      responses:
        "200": { description: ok }
`;

      expect(() => parseOpenApiSchemas(onlyPaths)).toThrow(TransformationError);
      expect(validateOpenApiSchemas(onlyPaths).map((d) => d.code)).toEqual([
        "openapi/no-schemas",
      ]);
    });

    it("refuses a document whose schemas describe no object", () => {
      expect(() =>
        parse(`
    Email: { type: string }
    Age: { type: integer }
`),
      ).toThrow(/no models to generate/);
    });

    it("refuses Swagger 2", () => {
      expect(() =>
        parseOpenApiSchemas('swagger: "2.0"\ninfo: { title: T, version: "1" }'),
      ).toThrow(TransformationError);
    });
  });
});

describe("the parser's second IR", () => {
  it("declares that it also produces a type graph", () => {
    expect(openApiParser.irKind).toBe("api");
    expect(openApiParser.alsoProduces).toBe("type-graph");
  });

  it("parses schemas through the declared hook", () => {
    const result = openApiParser.parseTypeGraph(
      doc(`
    Pet:
      type: object
      properties: { name: { type: string } }
`),
    );

    expect(result.root.name).toBe("Pet");
  });

  it("accepts a schemas-only document as valid", () => {
    // It used to be rejected for having no paths, which would have put the
    // language targets out of reach for exactly the documents suited to them.
    expect(
      openApiParser.validate(
        doc(`
    Pet:
      type: object
      properties: { name: { type: string } }
`),
      ),
    ).toEqual([]);
  });

  it("still refuses a schemas-only document when asked for operations", () => {
    expect(() =>
      openApiParser.parse(
        doc(`
    Pet:
      type: object
      properties: { name: { type: string } }
`),
      ),
    ).toThrow(/no paths/);
  });

  it("refuses a document that has neither half", () => {
    expect(
      openApiParser.validate('openapi: 3.0.3\ninfo: { title: T, version: "1" }')
        .map((d) => d.code),
    ).toEqual(["openapi/no-content"]);
  });
});
