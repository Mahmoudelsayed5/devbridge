import type { EnumNode, ObjectNode } from "@devbridge/core";
import { TransformationContext } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import type { PythonOptions } from "../index.js";
import { generatePython, pythonGenerator } from "../index.js";

function generate(value: unknown, options: PythonOptions = {}): string {
  const { root, context } = parseJson(JSON.stringify(value));

  return generatePython(root, context, options);
}

describe("generatePython", () => {
  it("emits dataclasses with postponed annotations", () => {
    const result = generate({ user: { id: 1 } });

    expect(result.startsWith("from __future__ import annotations\n")).toBe(
      true,
    );
    expect(result).toContain("from dataclasses import dataclass");
    expect(result).toContain("@dataclass\nclass Root:");
    expect(result).toContain("    user: User");
    expect(result).toContain("@dataclass\nclass User:");
    expect(result).toContain("    id: int");
  });

  it("maps primitives to Python types", () => {
    const result = generate({
      name: "x",
      count: 1,
      price: 1.5,
      active: true,
    });

    expect(result).toContain("name: str");
    expect(result).toContain("count: int");
    expect(result).toContain("price: float");
    expect(result).toContain("active: bool");
  });

  it("uses list annotations and Any for unknown elements", () => {
    expect(generate({ tags: ["a"] })).toContain("tags: list[str]");

    const empty = generate({ tags: [] });

    expect(empty).toContain("tags: list[Any]");
    expect(empty).toContain("from typing import Any");
  });

  it("uses Optional for nullable values", () => {
    const result = generate({ nickname: null, age: [1, null] });

    expect(result).toContain("nickname: None");
    expect(result).toContain("age: list[Optional[int]]");
    expect(result).toContain("from typing import Optional");
  });

  it("uses Union for mixed element types", () => {
    const result = generate({ values: [1, "a"] });

    expect(result).toContain("values: list[Union[int, str]]");
    expect(result).toContain("Union");
  });

  it("gives optional fields a None default and moves them last", () => {
    const result = generate({
      users: [{ id: 1, name: "x" }, { id: 2, email: "e" }],
    });

    const usersItem = result.slice(result.indexOf("class UsersItem:"));

    expect(usersItem).toContain("id: int\n");
    expect(usersItem).toContain("name: Optional[str] = None");
    expect(usersItem).toContain("email: Optional[str] = None");

    expect(usersItem.indexOf("id: int")).toBeLessThan(
      usersItem.indexOf("name: Optional[str] = None"),
    );
  });

  it("preserves JSON keys by default and can convert them", () => {
    expect(generate({ user_name: "x" })).toContain("user_name: str");
    expect(generate({ userName: "x" })).toContain("userName: str");

    expect(
      generate({ userName: "x" }, { fieldStyle: "snake_case" }),
    ).toContain("user_name: str");
  });

  it("escapes names that are not valid Python identifiers", () => {
    const result = generate({ "user-name": "x", class: 1, "2fa": true });

    expect(result).toContain("user_name: str");
    expect(result).toContain("class_: int");
    expect(result).toContain("_2fa: bool");
  });

  it("emits pass for an empty object", () => {
    expect(generate({ meta: {} })).toContain("class Meta:\n    pass");
  });

  it("separates top level definitions with two blank lines", () => {
    expect(generate({ user: { id: 1 } })).toContain("\n\n\n@dataclass");
  });

  it("exposes a single file through the registry entry", () => {
    const { root, context } = parseJson(JSON.stringify({ id: 1 }));

    const generated = pythonGenerator.generate(root, context);

    expect(pythonGenerator.id).toBe("python");
    expect(generated.files[0]?.path).toBe("models.py");
  });
});

describe("integer width", () => {
  it("uses int, because Python integers are arbitrary precision", () => {
    expect(generate({ bigId: 1234567890123 })).toContain("bigId: int");
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

  it("subclasses str so the member is its value", () => {
    const { root, context } = withEnums();
    const result = generatePython(root, context);

    // A plain Enum member is not equal to its value and will not serialise.
    expect(result).toContain("class Status(str, Enum):");
    expect(result).toContain('AVAILABLE = "available"');
    expect(result).toContain('SOLD_OUT = "sold out"');
  });

  it("subclasses int for an integer enum", () => {
    const { root, context } = withEnums();

    expect(generatePython(root, context)).toContain("class Priority(int, Enum):");
  });

  it("imports Enum only when there is one", () => {
    const { root, context } = withEnums();

    expect(generatePython(root, context)).toContain("from enum import Enum");
    expect(generatePython({ kind: "object", name: "X", properties: [] }, new TransformationContext()))
      .not.toContain("from enum import Enum");
  });
});
