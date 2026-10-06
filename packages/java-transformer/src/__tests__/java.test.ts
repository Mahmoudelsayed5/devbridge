import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import { generateJava, generateJavaFiles } from "../index";

describe("generateJava", () => {
  it("generates Java fields for primitive JSON values", () => {
    const input = JSON.stringify({
      id: 10,
      price: 19.99,
      name: "Mahmoud",
      active: true,
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("public class Root");
    expect(result).toContain("private int id;");
    expect(result).toContain("private double price;");
    expect(result).toContain("private String name;");
    expect(result).toContain("private boolean active;");
  });

  it("generates nested Java classes", () => {
    const input = JSON.stringify({
      name: "Mahmoud",
      address: {
        city: "Cairo",
      },
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("public class Root");
    expect(result).toContain("private Address address;");
    expect(result).toContain("class Address");
    expect(result).toContain("private String city;");
  });

  it("generates lists and the required import", () => {
    const input = JSON.stringify({
      tags: ["java", "typescript"],
      scores: [10, 20],
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("import java.util.List;");
    expect(result).toContain("private List<String> tags;");
    expect(result).toContain("private List<Integer> scores;");
  });

  it("uses boxed types for optional primitive fields", () => {
    const input = JSON.stringify({
      users: [{ id: 1, active: true }, { id: 2 }],
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("private List<UsersItem> users;");
    expect(result).toContain("class UsersItem");
    expect(result).toContain("private int id;");
    expect(result).toContain("private Boolean active;");
  });

  it("uses Object for unions of incompatible types", () => {
    const input = JSON.stringify({
      value: ["hello", 42],
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("private List<Object> value;");
  });

  it("uses Object for empty arrays with unknown element types", () => {
    const input = JSON.stringify({
      values: [],
    });

    const { root, context } = parseJson(input);
    const result = generateJava(root, context);

    expect(result).toContain("private List<Object> values;");
  });

  it("generates separate public Java files for nested objects", () => {
    const input = JSON.stringify({
      name: "Mahmoud",
      address: {
        city: "Cairo",
      },
    });

    const { root, context } = parseJson(input);
    const files = generateJavaFiles(root, context);

    expect(files["Root.java"]).toContain("public class Root");
    expect(files["Root.java"]).toContain("private Address address;");
    expect(files["Address.java"]).toContain("public class Address");
    expect(files["Address.java"]).toContain("private String city;");
  });

  it("includes imports only in files that need them", () => {
    const input = JSON.stringify({
      name: "Mahmoud",
      tags: ["java", "backend"],
      address: {
        city: "Cairo",
      },
    });

    const { root, context } = parseJson(input);
    const files = generateJavaFiles(root, context);

    expect(files["Root.java"]).toContain("import java.util.List;");
    expect(files["Root.java"]).toContain("private List<String> tags;");
    expect(files["Address.java"]).not.toContain("import java.util.List;");
  });
});
