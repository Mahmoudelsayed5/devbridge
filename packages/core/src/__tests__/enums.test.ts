import { describe, expect, it } from "vitest";

import type { EnumNode, ObjectNode } from "../index.js";
import { TransformationContext, enumMembersFrom, typeKey } from "../index.js";

const names = (values: readonly unknown[]): string[] =>
  enumMembersFrom(values)?.members.map((member) => member.name) ?? [];

describe("enumMembersFrom", () => {
  it("names members after their values", () => {
    const built = enumMembersFrom(["available", "pending"]);

    expect(built?.baseType).toBe("string");
    expect(built?.members).toEqual([
      { name: "Available", value: "available" },
      { name: "Pending", value: "pending" },
    ]);
  });

  it("keeps the value exactly while shaping the name", () => {
    const built = enumMembersFrom(["sold out", "kebab-case", "snake_case"]);

    expect(built?.members.map((member) => member.name)).toEqual([
      "SoldOut",
      "KebabCase",
      "SnakeCase",
    ]);

    // The point of separating the two: the wire value must survive intact.
    expect(built?.members.map((member) => member.value)).toEqual([
      "sold out",
      "kebab-case",
      "snake_case",
    ]);
  });

  it("falls back to a positional name when a value yields no identifier", () => {
    // "2xx" would start with a digit and "" has nothing usable at all.
    expect(names(["2xx", "ok"])).toEqual(["Value1", "Ok"]);
    expect(names(["", "ok"])).toEqual(["Value1", "Ok"]);
  });

  it("keeps names unique when two values reduce to the same one", () => {
    expect(names(["a-b", "a_b", "A B"])).toEqual(["AB", "AB2", "AB3"]);
  });

  it("names integer members positionally, including negatives", () => {
    const built = enumMembersFrom([1, 2, -3]);

    expect(built?.baseType).toBe("integer");
    expect(built?.members).toEqual([
      { name: "Value1", value: 1 },
      { name: "Value2", value: 2 },
      { name: "ValueMinus3", value: -3 },
    ]);
  });

  it("refuses values that cannot be one enum", () => {
    // No target can declare a single enum over mixed types.
    expect(enumMembersFrom(["a", 1])).toBeUndefined();
    expect(enumMembersFrom([])).toBeUndefined();
    expect(enumMembersFrom([true, false])).toBeUndefined();
    expect(enumMembersFrom(["a", null])).toBeUndefined();
    expect(enumMembersFrom([1.5, 2.5])).toBeUndefined();
  });
});

describe("typeKey", () => {
  it("distinguishes an enum from an object of the same name", () => {
    const object: ObjectNode = { kind: "object", name: "Status", properties: [] };

    const enumNode: EnumNode = {
      kind: "enum",
      name: "Status",
      baseType: "string",
      members: [{ name: "A", value: "a" }],
    };

    expect(typeKey(object)).not.toBe(typeKey(enumNode));
  });
});

describe("TransformationContext enums", () => {
  const status: EnumNode = {
    kind: "enum",
    name: "Status",
    baseType: "string",
    members: [{ name: "Available", value: "available" }],
  };

  it("keeps enums separate from object types", () => {
    const context = new TransformationContext();

    context.registerType({ kind: "object", name: "Pet", properties: [] });
    context.registerEnum(status);

    expect(context.getTypes().map((type) => type.name)).toEqual(["Pet"]);
    expect(context.getEnums().map((node) => node.name)).toEqual(["Status"]);
    expect(context.hasEnum("Status")).toBe(true);
    expect(context.hasType("Status")).toBe(false);
    expect(context.getEnum("Status")).toBe(status);
  });

  it("preserves registration order", () => {
    const context = new TransformationContext();

    for (const name of ["C", "A", "B"]) {
      context.registerEnum({ ...status, name });
    }

    expect(context.getEnums().map((node) => node.name)).toEqual(["C", "A", "B"]);
  });

  it("refuses a name an object already holds, and the reverse", () => {
    // Every target declares both in one namespace, so this would reach the
    // compiler as a redeclaration if it were allowed through.
    const a = new TransformationContext();

    a.registerType({ kind: "object", name: "Status", properties: [] });
    expect(() => a.registerEnum(status)).toThrow(/namespace/);

    const b = new TransformationContext();

    b.registerEnum(status);
    expect(() =>
      b.registerType({ kind: "object", name: "Status", properties: [] }),
    ).toThrow(/namespace/);
  });
});
