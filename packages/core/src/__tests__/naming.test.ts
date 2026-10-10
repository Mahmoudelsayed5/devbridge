import { describe, expect, it } from "vitest";

import {
  NameAllocator,
  primitive,
  sanitizeIdentifier,
  splitNullable,
  splitWords,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  typeKey,
} from "../index.js";

describe("splitWords", () => {
  it("splits every common identifier convention", () => {
    expect(splitWords("user_name")).toEqual(["user", "name"]);
    expect(splitWords("user-name")).toEqual(["user", "name"]);
    expect(splitWords("userName")).toEqual(["user", "name"]);
    expect(splitWords("UserName")).toEqual(["user", "name"]);
    expect(splitWords("user name")).toEqual(["user", "name"]);
    expect(splitWords("parseHTTPResponse")).toEqual([
      "parse",
      "http",
      "response",
    ]);
    expect(splitWords("address2")).toEqual(["address", "2"]);
    expect(splitWords("")).toEqual([]);
  });
});

describe("case helpers", () => {
  it("converts to the requested convention", () => {
    expect(toPascalCase("user_name")).toBe("UserName");
    expect(toCamelCase("user_name")).toBe("userName");
    expect(toSnakeCase("userName")).toBe("user_name");
    expect(toCamelCase("")).toBe("");
  });
});

describe("sanitizeIdentifier", () => {
  it("removes illegal characters and escapes keywords", () => {
    expect(sanitizeIdentifier("my-field")).toBe("my_field");
    expect(sanitizeIdentifier("2fa")).toBe("_2fa");
    expect(sanitizeIdentifier("")).toBe("value");
    expect(
      sanitizeIdentifier("class", { keywords: new Set(["class"]) }),
    ).toBe("class_");
  });
});

describe("NameAllocator", () => {
  it("suffixes names that are already taken", () => {
    const allocator = new NameAllocator(["Root"]);

    expect(allocator.allocate("Root")).toBe("Root2");
    expect(allocator.allocate("User")).toBe("User");
    expect(allocator.allocate("User")).toBe("User2");
    expect(allocator.allocate("User")).toBe("User3");
  });
});

describe("splitNullable", () => {
  it("separates null from the rest of a union", () => {
    expect(
      splitNullable({
        kind: "union",
        types: [primitive("string"), primitive("null")],
      }),
    ).toEqual({ nullable: true, type: primitive("string") });

    expect(splitNullable(primitive("string"))).toEqual({
      nullable: false,
      type: primitive("string"),
    });

    expect(splitNullable(primitive("null"))).toEqual({
      nullable: true,
      type: primitive("null"),
    });

    const multi = splitNullable({
      kind: "union",
      types: [primitive("string"), primitive("integer"), primitive("null")],
    });

    expect(multi.nullable).toBe(true);
    expect(multi.type).toEqual({
      kind: "union",
      types: [primitive("string"), primitive("integer")],
    });
  });
});

describe("typeKey", () => {
  it("is stable regardless of union member order", () => {
    const a = typeKey({
      kind: "union",
      types: [primitive("string"), primitive("null")],
    });

    const b = typeKey({
      kind: "union",
      types: [primitive("null"), primitive("string")],
    });

    expect(a).toBe(b);
  });
});
