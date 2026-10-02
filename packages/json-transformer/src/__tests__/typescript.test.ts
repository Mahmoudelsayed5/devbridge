import { describe, expect, it } from "vitest";
import { generateTypeScript, parseJson } from "../index";

describe("generateTypeScript", () => {
  it("generates TypeScript interfaces from JSON", () => {
    const input = JSON.stringify({
      user: {
        id: 10,
        name: "Mahmoud",
        active: true,
      },
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("interface User");

    expect(result).toContain("id: number;");

    expect(result).toContain("name: string;");

    expect(result).toContain("active: boolean;");

    expect(result).toContain("interface Root");

    expect(result).toContain("user: User;");
  });

  it("generates arrays of primitive values", () => {
    const input = JSON.stringify({
      tags: ["java", "spring", "docker"],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("tags: string[];");
  });

  it("generates arrays containing multiple primitive types", () => {
    const input = JSON.stringify({
      values: [10, "hello", true],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("values: (number | string | boolean)[];");
  });

  it("merges objects inside arrays and makes missing properties optional", () => {
    const input = JSON.stringify({
      users: [
        {
          id: 1,
          name: "Mahmoud",
        },
        {
          id: 2,
          email: "test@example.com",
        },
      ],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("id: number;");
    expect(result).toContain("name?: string;");
    expect(result).toContain("email?: string;");
    expect(result).toContain("users: UsersItem[];");
  });

  it("generates nullable properties", () => {
    const input = JSON.stringify({
      name: "Mahmoud",
      nickname: null,
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("name: string;");
    expect(result).toContain("nickname: null;");
  });

  it("generates unknown arrays for empty arrays", () => {
    const input = JSON.stringify({
      users: [],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("users: unknown[];");
  });

  it("generates nullable array elements", () => {
    const input = JSON.stringify({
      values: [1, 2, null],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("values: (number | null)[];");
  });

  it("generates nullable properties when objects have different value types", () => {
    const input = JSON.stringify({
      users: [
        {
          name: "Mahmoud",
          age: 25,
        },
        {
          name: "Ahmed",
          age: null,
        },
      ],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("name: string;");
    expect(result).toContain("age: number | null;");
  });

  it("generates nested objects inside array items", () => {
    const input = JSON.stringify({
      users: [
        {
          id: 1,
          profile: {
            city: "Cairo",
            country: "Egypt",
          },
        },
        {
          id: 2,
          profile: {
            city: "Alexandria",
            country: "Egypt",
          },
        },
      ],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("interface Profile");
    expect(result).toContain("profile: Profile;");
    expect(result).toContain("city: string;");
    expect(result).toContain("country: string;");
  });

  it("makes nested object properties optional when missing from some array items", () => {
    const input = JSON.stringify({
      users: [
        {
          id: 1,
          profile: {
            city: "Cairo",
          },
        },
        {
          id: 2,
        },
      ],
    });

    const { root, context } = parseJson(input);

    const result = generateTypeScript(root, context);

    expect(result).toContain("interface UsersItem");
    expect(result).toContain("profile?: Profile;");
    expect(result).toContain("city: string;");
  });
});
