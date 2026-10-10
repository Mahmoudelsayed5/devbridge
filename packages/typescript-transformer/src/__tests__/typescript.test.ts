import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import type { TypeScriptOptions } from "../index.js";
import { generateTypeScript, typeScriptGenerator } from "../index.js";

function generate(value: unknown, options: TypeScriptOptions = {}): string {
  const { root, context } = parseJson(JSON.stringify(value));

  return generateTypeScript(root, context, options);
}

describe("generateTypeScript", () => {
  it("generates TypeScript interfaces from JSON", () => {
    const result = generate({
      user: {
        id: 10,
        name: "Mahmoud",
        active: true,
      },
    });

    expect(result).toContain("interface User");
    expect(result).toContain("id: number;");
    expect(result).toContain("name: string;");
    expect(result).toContain("active: boolean;");
    expect(result).toContain("interface Root");
    expect(result).toContain("user: User;");
  });

  it("emits well formed, indented and exported declarations", () => {
    const result = generate({ user: { id: 1 } });

    expect(result).toBe(
      [
        "export interface Root {",
        "  user: User;",
        "}",
        "",
        "export interface User {",
        "  id: number;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("can omit exports and use type aliases", () => {
    const result = generate(
      { id: 1 },
      { exportTypes: false, style: "type", indent: "    " },
    );

    expect(result).toBe(["type Root = {", "    id: number;", "};", ""].join("\n"));
  });

  it("quotes property names that are not valid identifiers", () => {
    const result = generate({ "user-name": "x", "2fa": true, ok: 1 });

    expect(result).toContain('"user-name": string;');
    expect(result).toContain('"2fa": boolean;');
    expect(result).toContain("ok: number;");
  });

  it("generates arrays of primitive values", () => {
    expect(generate({ tags: ["java", "spring", "docker"] })).toContain(
      "tags: string[];",
    );
  });

  it("generates arrays containing multiple primitive types", () => {
    expect(generate({ values: [10, "hello", true] })).toContain(
      "values: (number | string | boolean)[];",
    );
  });

  it("merges objects inside arrays and makes missing properties optional", () => {
    const result = generate({
      users: [
        { id: 1, name: "Mahmoud" },
        { id: 2, email: "test@example.com" },
      ],
    });

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("id: number;");
    expect(result).toContain("name?: string;");
    expect(result).toContain("email?: string;");
    expect(result).toContain("users: UsersItem[];");
  });

  it("generates nullable properties", () => {
    const result = generate({ name: "Mahmoud", nickname: null });

    expect(result).toContain("name: string;");
    expect(result).toContain("nickname: null;");
  });

  it("generates unknown arrays for empty arrays", () => {
    expect(generate({ users: [] })).toContain("users: unknown[];");
  });

  it("generates nullable array elements", () => {
    expect(generate({ values: [1, 2, null] })).toContain(
      "values: (number | null)[];",
    );
  });

  it("generates nullable properties when objects have different value types", () => {
    const result = generate({
      users: [
        { name: "Mahmoud", age: 25 },
        { name: "Ahmed", age: null },
      ],
    });

    expect(result).toContain("name: string;");
    expect(result).toContain("age: number | null;");
  });

  it("generates nested objects inside array items", () => {
    const result = generate({
      users: [
        { id: 1, profile: { city: "Cairo", country: "Egypt" } },
        { id: 2, profile: { city: "Alexandria", country: "Egypt" } },
      ],
    });

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("interface Profile");
    expect(result).toContain("profile: Profile;");
    expect(result).toContain("city: string;");
    expect(result).toContain("country: string;");
  });

  it("makes nested object properties optional when missing from some array items", () => {
    const result = generate({
      users: [{ id: 1, profile: { city: "Cairo" } }, { id: 2 }],
    });

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("profile?: Profile;");
    expect(result).toContain("city: string;");
  });

  it("widens a nested object across array items instead of dropping fields", () => {
    const result = generate({
      users: [
        { profile: { city: "Cairo" } },
        { profile: { city: "Giza", zip: 123 } },
      ],
    });

    expect(result).toContain("city: string;");
    expect(result).toContain("zip?: number;");
  });

  it("exposes a registry entry that emits a single file", () => {
    const { root, context } = parseJson(JSON.stringify({ id: 1 }));

    const generated = typeScriptGenerator.generate(root, context);

    expect(typeScriptGenerator.id).toBe("typescript");
    expect(generated.files).toHaveLength(1);
    expect(generated.files[0]?.path).toBe("types.ts");
    expect(generated.preview).toBe(generated.files[0]?.content);
  });
});
