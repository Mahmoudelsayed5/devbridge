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
