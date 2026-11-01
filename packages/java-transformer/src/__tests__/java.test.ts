import type { EnumNode, ObjectNode } from "@devbridge/core";
import { TransformationContext, primitive } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import type { JavaFiles, JavaOptions } from "../index.js";
import { generateJava, generateJavaFiles, javaGenerator } from "../index.js";

function preview(value: unknown, options: JavaOptions = {}): string {
  const { root, context } = parseJson(JSON.stringify(value));

  return generateJava(root, context, options);
}

function files(value: unknown, options: JavaOptions = {}): JavaFiles {
  const { root, context } = parseJson(JSON.stringify(value));

  return generateJavaFiles(root, context, options);
}

describe("generateJava", () => {
  it("generates Java fields for primitive JSON values", () => {
    const result = preview({
      id: 10,
      price: 19.99,
      name: "Mahmoud",
      active: true,
    });

    expect(result).toContain("public class Root");
    expect(result).toContain("private int id;");
    expect(result).toContain("private double price;");
    expect(result).toContain("private String name;");
    expect(result).toContain("private boolean active;");
  });

  it("generates nested Java classes", () => {
    const result = preview({ name: "Mahmoud", address: { city: "Cairo" } });

    expect(result).toContain("public class Root");
    expect(result).toContain("private Address address;");
    expect(result).toContain("class Address");
    expect(result).toContain("private String city;");
  });

  it("generates lists and the required import", () => {
    const result = preview({ tags: ["java", "typescript"], scores: [10, 20] });

    expect(result).toContain("import java.util.List;");
    expect(result).toContain("private List<String> tags;");
    expect(result).toContain("private List<Integer> scores;");
  });

  it("uses boxed types for optional primitive fields", () => {
    const result = preview({ users: [{ id: 1, active: true }, { id: 2 }] });

    expect(result).toContain("private List<UsersItem> users;");
    expect(result).toContain("class UsersItem");
    expect(result).toContain("private int id;");
    expect(result).toContain("private Boolean active;");
  });

  it("uses boxed types for nullable primitive fields", () => {
    const result = preview({ age: null, count: [1, null] });

    expect(result).toContain("private Object age;");
    expect(result).toContain("private List<Integer> count;");
  });

  it("uses Object for unions of incompatible types", () => {
    expect(preview({ value: ["hello", 42] })).toContain(
      "private List<Object> value;",
    );
  });

  it("uses Object for empty arrays with unknown element types", () => {
    expect(preview({ values: [] })).toContain("private List<Object> values;");
  });

  it("generates getters and setters by default", () => {
    const result = preview({ userName: "Mahmoud" });

    expect(result).toContain("public String getUserName() {");
    expect(result).toContain("return this.userName;");
    expect(result).toContain("public void setUserName(String userName) {");
    expect(result).toContain("this.userName = userName;");
  });

  it("can omit accessors", () => {
    const result = preview({ id: 1 }, { accessors: false });

    expect(result).toContain("private int id;");
    expect(result).not.toContain("getId");
  });

  it("converts JSON keys to Java field names", () => {
    const result = preview({ "user-name": "x", user_id: 1, "2fa": true });

    expect(result).toContain("private String userName;");
    expect(result).toContain("private int userId;");
    expect(result).toContain("private boolean _2fa;");
  });

  it("escapes Java keywords used as field names", () => {
    expect(preview({ class: "a", static: 1 })).toContain(
      "private String class_;",
    );
  });

  it("adds Jackson annotations only when a name was changed", () => {
    const result = preview(
      { "user-name": "x", id: 1 },
      { jsonAnnotations: true },
    );

    expect(result).toContain("import com.fasterxml.jackson.annotation.JsonProperty;");
    expect(result).toContain('@JsonProperty("user-name")');
    expect(result).not.toContain('@JsonProperty("id")');
  });

  it("emits a package declaration when asked", () => {
    const result = preview({ id: 1 }, { packageName: "com.example.model" });

    expect(result.startsWith("package com.example.model;")).toBe(true);
  });

  it("can emit records instead of classes", () => {
    const result = preview(
      { id: 1, name: "Mahmoud", tags: ["a"] },
      { style: "record" },
    );

    expect(result).toContain(
      "public record Root(int id, String name, List<String> tags) {",
    );
  });
});

describe("generateJavaFiles", () => {
  it("generates separate public Java files for nested objects", () => {
    const generated = files({ name: "Mahmoud", address: { city: "Cairo" } });

    expect(generated["Root.java"]).toContain("public class Root");
    expect(generated["Root.java"]).toContain("private Address address;");
    expect(generated["Address.java"]).toContain("public class Address");
    expect(generated["Address.java"]).toContain("private String city;");
  });

  it("includes imports only in files that need them", () => {
    const generated = files({
      name: "Mahmoud",
      tags: ["java", "backend"],
      address: { city: "Cairo" },
    });

    expect(generated["Root.java"]).toContain("import java.util.List;");
    expect(generated["Root.java"]).toContain("private List<String> tags;");
    expect(generated["Address.java"]).not.toContain("import java.util.List;");
  });

  it("does not import List because a referenced class uses one", () => {
    const generated = files({ address: { tags: ["a"] } });

    expect(generated["Root.java"]).not.toContain("import java.util.List;");
    expect(generated["Address.java"]).toContain("import java.util.List;");
  });

  it("puts every file in the requested package", () => {
    const generated = files(
      { address: { city: "Cairo" } },
      { packageName: "com.example" },
    );

    expect(generated["Root.java"]?.startsWith("package com.example;")).toBe(
      true,
    );
    expect(generated["Address.java"]?.startsWith("package com.example;")).toBe(
      true,
    );
  });
});

describe("javaGenerator", () => {
  it("exposes one file per type through the registry entry", () => {
    const { root, context } = parseJson(
      JSON.stringify({ address: { city: "Cairo" } }),
    );

    const generated = javaGenerator.generate(root, context);

    expect(javaGenerator.id).toBe("java");
    expect(javaGenerator.filePerType).toBe(true);
    expect(generated.files.map((file) => file.path).sort()).toEqual([
      "Address.java",
      "Root.java",
    ]);
  });
});

describe("integer width", () => {
  it("uses long for a value beyond the 32-bit range", () => {
    expect(preview({ id: 1, bigId: 1234567890123 })).toContain(
      "private long bigId;",
    );
  });

  it("boxes a long when the field is optional", () => {
    const result = preview({ rows: [{ id: 5000000000 }, {}] });

    expect(result).toContain("private Long id;");
  });

  it("uses List<Long> for a long array", () => {
    expect(preview({ ids: [5000000000] })).toContain("private List<Long> ids;");
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

  it("gives each constant the value it came from", () => {
    const { root, context } = withEnums();
    const emitted = generateJavaFiles(root, context);

    // A bare constant would lose the mapping: Java constants are SHOUTY and
    // the wire value usually is not.
    expect(emitted["Status.java"]).toContain('AVAILABLE("available"),');
    expect(emitted["Status.java"]).toContain('SOLD_OUT("sold out");');
    expect(emitted["Status.java"]).toContain("private final String value;");
  });

  it("uses int for an integer enum", () => {
    const { root, context } = withEnums();
    const emitted = generateJavaFiles(root, context);

    expect(emitted["Priority.java"]).toContain("LOW(1),");
    expect(emitted["Priority.java"]).toContain("private final int value;");
    expect(emitted["Priority.java"]).toContain("candidate.value == value");
  });

  it("compares strings with equals, not ==", () => {
    const { root, context } = withEnums();
    const emitted = generateJavaFiles(root, context);

    expect(emitted["Status.java"]).toContain("candidate.value.equals(value)");
  });

  it("writes each enum to its own file, as Java requires", () => {
    const { root, context } = withEnums();
    const emitted = generateJavaFiles(root, context);

    expect(Object.keys(emitted).sort()).toEqual([
      "Pet.java",
      "Priority.java",
      "Status.java",
    ]);
  });

  it("adds the Jackson hooks only when annotations are on", () => {
    const { root, context } = withEnums();

    expect(generateJavaFiles(root, context, { jsonAnnotations: true })["Status.java"])
      .toContain("@JsonValue");

    expect(generateJavaFiles(root, context)["Status.java"]).not.toContain(
      "@JsonValue",
    );
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

  it("uses Map<String, T> with a boxed value", () => {
    const { root, context } = withMaps();
    const emitted = generateJavaFiles(root, context);

    expect(emitted["Doc.java"]).toContain("private Map<String, String> labels;");
    expect(emitted["Doc.java"]).toContain("private Map<String, Tag> tagsByKey;");
    expect(emitted["Doc.java"]).toContain(
      "private Map<String, List<String>> listsByKey;",
    );
  });

  it("imports every java.util type the properties use, not just one", () => {
    const { root, context } = withMaps();
    const emitted = generateJavaFiles(root, context);

    // A map of lists needs both, which is why import collection recurses.
    expect(emitted["Doc.java"]).toContain("import java.util.List;");
    expect(emitted["Doc.java"]).toContain("import java.util.Map;");
  });

  it("boxes the value type, since generics cannot hold primitives", () => {
    const context = new TransformationContext();

    const root: ObjectNode = {
      kind: "object",
      name: "Doc",
      properties: [
        {
          name: "counts",
          value: { kind: "map", valueType: primitive("integer") },
          optional: false,
        },
      ],
    };

    context.registerType(root);

    expect(generateJavaFiles(root, context)["Doc.java"]).toContain(
      "Map<String, Integer>",
    );
  });
});
