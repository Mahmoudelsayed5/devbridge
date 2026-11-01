import type { EnumNode, ObjectNode, ObjectProperty } from "@devbridge/core";
import { TransformationContext, primitive } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import type { GoOptions } from "../index.js";
import { generateGo, goGenerator } from "../index.js";

function generate(value: unknown, options: GoOptions = {}): string {
  const { root, context } = parseJson(JSON.stringify(value));

  return generateGo(root, context, options);
}

/** gofmt aligns struct columns, so compare on collapsed whitespace. */
function collapse(value: string): string {
  return value.replace(/[ \t]+/g, " ");
}

describe("generateGo", () => {
  it("emits a package clause and one struct per type", () => {
    const result = generate({ user: { id: 1 } });

    expect(result.startsWith("package models\n")).toBe(true);
    expect(result).toContain("type Root struct {");
    expect(result).toContain("type User struct {");
  });

  it("maps primitives to Go types with json tags", () => {
    const result = generate({
      id: 10,
      price: 19.99,
      name: "Mahmoud",
      active: true,
    });

    expect(collapse(result)).toContain('Id int `json:"id"`');
    expect(collapse(result)).toContain('Price float64 `json:"price"`');
    expect(collapse(result)).toContain('Name string `json:"name"`');
    expect(collapse(result)).toContain('Active bool `json:"active"`');
  });

  it("aligns struct columns", () => {
    const result = generate({ id: 1, price: 1.5 });

    expect(result).toContain("\tId    int");
    expect(result).toContain("\tPrice float64");
  });

  it("exports fields and keeps the original key in the tag", () => {
    const result = generate({ "user-name": "x", user_id: 1 });

    expect(result).toContain('`json:"user-name"`');
    expect(result).toContain("UserName");
    expect(result).toContain("UserId");
  });

  it("uses slices for arrays", () => {
    const result = generate({ tags: ["a"], matrix: [[1]] });

    expect(result).toContain("[]string");
    expect(result).toContain("[][]int");
  });

  it("uses any for unknown and mixed element types", () => {
    expect(generate({ values: [] })).toContain("[]any");
    expect(generate({ values: [1, "a"] })).toContain("[]any");
  });

  it("uses pointers and omitempty for optional fields", () => {
    const result = generate({ users: [{ id: 1, name: "x" }, { id: 2 }] });

    expect(result).toContain("*string");
    expect(result).toContain(',omitempty"`');
  });

  it("uses a pointer for a nullable field but not for a nullable slice", () => {
    const result = generate({ age: [1, null], nickname: null });

    expect(result).toContain("[]*int");
    expect(result).toContain("Nickname any");
  });

  it("can disable pointers and tags", () => {
    const result = generate(
      { users: [{ id: 1, name: "x" }, { id: 2 }] },
      { pointersForOptional: false, jsonAnnotations: false },
    );

    expect(result).not.toContain("*string");
    expect(result).not.toContain("json:");
  });

  it("honours a custom package name", () => {
    expect(generate({ id: 1 }, { packageName: "api" })).toContain(
      "package api",
    );
  });

  it("exposes a single file through the registry entry", () => {
    const { root, context } = parseJson(JSON.stringify({ id: 1 }));

    const generated = goGenerator.generate(root, context);

    expect(goGenerator.id).toBe("go");
    expect(generated.files[0]?.path).toBe("models.go");
  });
});

describe("integer width", () => {
  it("uses int64 beyond the 32-bit range and int inside it", () => {
    const result = collapse(generate({ small: 7, big: 1234567890123 }));

    expect(result).toContain("Small int ");
    expect(result).toContain("Big int64 ");
  });

  it("uses a pointer for an optional long", () => {
    expect(generate({ rows: [{ id: 5000000000 }, {}] })).toContain("*int64");
  });
});

describe("recursive types", () => {
  /** Builds a type graph directly: JSON samples cannot describe a cycle. */
  function cyclic(): { root: ObjectNode; context: TransformationContext } {
    const context = new TransformationContext();

    const parent: { kind: "object"; name: string; properties: ObjectProperty[] } =
      { kind: "object", name: "Parent", properties: [] };

    const child: { kind: "object"; name: string; properties: ObjectProperty[] } =
      { kind: "object", name: "Child", properties: [] };

    parent.properties.push({ name: "child", value: child, optional: false });
    child.properties.push({ name: "parent", value: parent, optional: false });

    context.registerType(parent);
    context.registerType(child);

    return { root: parent, context };
  }

  it("breaks a cycle with a pointer, on exactly one edge", () => {
    const { root, context } = cyclic();
    const result = collapse(generateGo(root, context));

    // A struct containing itself by value is rejected by the Go compiler as
    // an invalid recursive type; a pointer has a known size.
    expect(result).toContain("Parent *Parent");
    expect(result).toContain("Child Child");
  });

  it("leaves a non-cyclic nested struct as a value", () => {
    const result = collapse(generate({ inner: { value: "x" } }));

    expect(result).not.toContain("*Inner");
  });

  it("needs no pointer for recursion through a slice", () => {
    const context = new TransformationContext();

    const node: { kind: "object"; name: string; properties: ObjectProperty[] } =
      { kind: "object", name: "Node", properties: [] };

    node.properties.push({
      name: "children",
      value: { kind: "array", elementType: node },
      optional: false,
    });

    context.registerType(node);

    // A slice already holds its elements indirectly, so []Node inside Node
    // is a legal Go type as it stands.
    expect(collapse(generateGo(node, context))).toContain("Children []Node");
  });
});

describe("enums", () => {
  /** One string enum, one integer enum, and an object using both. */
  function withEnums(): { root: ObjectNode; context: TransformationContext } {
    const context = new TransformationContext();

    const status: EnumNode = {
      kind: "enum",
      name: "Status",
      baseType: "string",
      members: [
        { name: "Available", value: "available" },
        { name: "SoldOut", value: "sold out" },
      ],
    };

    const priority: EnumNode = {
      kind: "enum",
      name: "Priority",
      baseType: "integer",
      members: [
        { name: "Low", value: 1 },
        { name: "High", value: 9 },
      ],
    };

    const root: ObjectNode = {
      kind: "object",
      name: "Pet",
      properties: [{ name: "status", value: status, optional: false }],
    };

    context.registerEnum(status);
    context.registerEnum(priority);
    context.registerType(root);

    return { root, context };
  }

  it("uses a defined type and typed constants, as Go does", () => {
    const { root, context } = withEnums();
    const result = collapse(generateGo(root, context));

    // Go has no enum keyword; this is the shape its standard library uses.
    expect(result).toContain("type Status string");
    expect(result).toContain('StatusAvailable Status = "available"');
    expect(result).toContain('StatusSoldOut Status = "sold out"');
  });

  it("prefixes constants with the type name", () => {
    const { root, context } = withEnums();

    // Go constants are package scoped, so two enums with a shared member name
    // would collide without the prefix.
    expect(generateGo(root, context)).toContain("PriorityLow");
  });

  it("uses int for an integer enum", () => {
    const { root, context } = withEnums();
    const result = collapse(generateGo(root, context));

    expect(result).toContain("type Priority int");
    expect(result).toContain("PriorityLow Priority = 1");
  });
});

describe("maps", () => {
  function withMaps(): { root: ObjectNode; context: TransformationContext } {
    const context = new TransformationContext();

    const tag: ObjectNode = {
      kind: "object",
      name: "Tag",
      properties: [{ name: "label", value: primitive("string"), optional: true }],
    };

    const root: ObjectNode = {
      kind: "object",
      name: "Doc",
      properties: [
        {
          name: "labels",
          value: { kind: "map", valueType: primitive("string") },
          optional: false,
        },
        {
          name: "tagsByKey",
          value: { kind: "map", valueType: tag },
          optional: false,
        },
        {
          name: "listsByKey",
          value: {
            kind: "map",
            valueType: { kind: "array", elementType: primitive("string") },
          },
          optional: false,
        },
        {
          name: "anything",
          value: { kind: "map", valueType: primitive("unknown") },
          optional: false,
        },
      ],
    };

    context.registerType(root);
    context.registerType(tag);

    return { root, context };
  }

  it("uses map[string]T", () => {
    const { root, context } = withMaps();
    const result = collapse(generateGo(root, context));

    expect(result).toContain("Labels map[string]string");
    expect(result).toContain("TagsByKey map[string]Tag");
    expect(result).toContain("ListsByKey map[string][]string");
    expect(result).toContain("Anything map[string]any");
  });

  it("needs no pointer for an optional map, which is nil-able already", () => {
    const context = new TransformationContext();

    const root: ObjectNode = {
      kind: "object",
      name: "Doc",
      properties: [
        {
          name: "labels",
          value: { kind: "map", valueType: primitive("string") },
          optional: true,
        },
      ],
    };

    context.registerType(root);

    expect(generateGo(root, context)).not.toContain("*map[");
  });
});

describe("discriminated unions", () => {
  function withDiscriminator(): {
    root: ObjectNode;
    context: TransformationContext;
  } {
    const context = new TransformationContext();

    const cat: ObjectNode = {
      kind: "object",
      name: "Cat",
      properties: [
        { name: "petType", value: { kind: "literal", value: "cat" }, optional: false },
      ],
    };

    const dog: ObjectNode = {
      kind: "object",
      name: "Dog",
      properties: [
        { name: "petType", value: { kind: "literal", value: "dog" }, optional: false },
      ],
    };

    const root: ObjectNode = {
      kind: "object",
      name: "Shelter",
      properties: [
        {
          name: "resident",
          value: {
            kind: "union",
            types: [cat, dog],
            discriminator: {
              propertyName: "petType",
              mapping: [
                { value: "cat", typeName: "Cat" },
                { value: "dog", typeName: "Dog" },
              ],
            },
          },
          optional: false,
        },
      ],
    };

    context.registerType(root);
    context.registerType(cat);
    context.registerType(dog);

    return { root, context };
  }

  it("emits the tag as a plain string, Go having no literal types", () => {
    const { root, context } = withDiscriminator();

    expect(collapse(generateGo(root, context))).toContain("PetType string");
  });

  it("reports that the union is emitted untyped", () => {
    const { root, context } = withDiscriminator();
    const diagnostics = goGenerator.generate(root, context).diagnostics ?? [];

    expect(diagnostics.map((d) => d.code)).toEqual([
      "go/discriminator-unsupported",
    ]);

    expect(diagnostics[0]?.message).toContain("petType");
  });
});
