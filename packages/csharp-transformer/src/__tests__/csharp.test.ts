import type { EnumNode, ObjectNode } from "@devbridge/core";
import { TransformationContext } from "@devbridge/core";
import { describe, expect, it } from "vitest";

import { parseJson } from "@devbridge/json-transformer";

import type { CSharpOptions } from "../index.js";
import {
  cSharpGenerator,
  generateCSharp,
  generateCSharpFiles,
} from "../index.js";

function generate(value: unknown, options: CSharpOptions = {}): string {
  const { root, context } = parseJson(JSON.stringify(value));

  return generateCSharp(root, context, options);
}

describe("generateCSharp", () => {
  it("emits Allman-braced classes with auto properties", () => {
    const result = generate({ user: { id: 1 } });

    expect(result).toContain("public class Root\n{\n");
    expect(result).toContain("public required User User { get; set; }");
    expect(result).toContain("public class User\n{\n");
    expect(result).toContain("public required int Id { get; set; }");
  });

  it("maps primitives to C# types", () => {
    const result = generate({
      name: "x",
      count: 1,
      price: 1.5,
      active: true,
    });

    expect(result).toContain("string Name");
    expect(result).toContain("int Count");
    expect(result).toContain("double Price");
    expect(result).toContain("bool Active");
  });

  it("uses List and the matching using directive", () => {
    const result = generate({ tags: ["a"] });

    expect(result).toContain("using System.Collections.Generic;");
    expect(result).toContain("List<string> Tags");
  });

  it("uses object for unknown and mixed element types", () => {
    expect(generate({ values: [] })).toContain("List<object> Values");
    expect(generate({ values: [1, "a"] })).toContain("List<object> Values");
  });

  it("makes optional and nullable members nullable instead of required", () => {
    const result = generate({ users: [{ id: 1, name: "x" }, { id: 2 }] });

    expect(result).toContain("public string? Name { get; set; }");
    expect(result).not.toContain("required string? Name");
    expect(result).toContain("public required int Id { get; set; }");
  });

  it("marks nullable list elements", () => {
    expect(generate({ ages: [1, null] })).toContain("List<int?> Ages");
  });

  it("can target a language version without required members", () => {
    const result = generate({ id: 1 }, { useRequired: false });

    expect(result).toContain("public int Id { get; set; }");
    expect(result).not.toContain("required");
  });

  it("adds JsonPropertyName when the property was renamed", () => {
    const result = generate({ user_name: "x" });

    expect(result).toContain("using System.Text.Json.Serialization;");
    expect(result).toContain('[JsonPropertyName("user_name")]');
    expect(result).toContain("public required string UserName { get; set; }");
  });

  it("can disable serialization attributes", () => {
    const result = generate({ user_name: "x" }, { jsonAnnotations: false });

    expect(result).not.toContain("JsonPropertyName");
    expect(result).not.toContain("using System.Text.Json.Serialization;");
  });

  it("keeps reserved words usable by capitalising them", () => {
    const result = generate({ class: 1, string: "a" });

    expect(result).toContain("public required int Class { get; set; }");
    expect(result).toContain("public required string String { get; set; }");
    expect(result).toContain('[JsonPropertyName("class")]');
  });

  it("emits a file scoped namespace when asked", () => {
    const result = generate({ id: 1 }, { packageName: "Example.Models" });

    expect(result).toContain("namespace Example.Models;");
  });

  it("can emit positional records", () => {
    const result = generate({ id: 1, name: "x" }, { style: "record" });

    expect(result).toContain("public record Root(int Id, string Name);");
  });
});

describe("generateCSharpFiles", () => {
  it("writes one file per type with its own usings", () => {
    const { root, context } = parseJson(
      JSON.stringify({ address: { tags: ["a"] } }),
    );

    const files = generateCSharpFiles(root, context, {
      packageName: "Example",
    });

    expect(Object.keys(files).sort()).toEqual(["Address.cs", "Root.cs"]);
    expect(files["Root.cs"]).toContain("namespace Example;");
    expect(files["Root.cs"]).not.toContain("using System.Collections.Generic;");
    expect(files["Address.cs"]).toContain("using System.Collections.Generic;");
  });
});

describe("cSharpGenerator", () => {
  it("reports one file per type", () => {
    const { root, context } = parseJson(
      JSON.stringify({ address: { city: "Cairo" } }),
    );

    const generated = cSharpGenerator.generate(root, context);

    expect(cSharpGenerator.id).toBe("csharp");
    expect(cSharpGenerator.filePerType).toBe(true);
    expect(generated.files.map((file) => file.path).sort()).toEqual([
      "Address.cs",
      "Root.cs",
    ]);
  });
});

describe("integer width", () => {
  it("uses long beyond the 32-bit range", () => {
    expect(generate({ bigId: 1234567890123 })).toContain(
      "public required long BigId { get; set; }",
    );
  });

  it("makes an optional long nullable", () => {
    expect(generate({ rows: [{ id: 5000000000 }, {}] })).toContain("long?");
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

  it("declares a real enum with the converter attribute", () => {
    const { root, context } = withEnums();
    const result = generateCSharp(root, context);

    expect(result).toContain("[JsonConverter(typeof(JsonStringEnumConverter))]");
    expect(result).toContain("public enum Status");
    expect(result).toContain("Available,");
  });

  it("assigns declared values to an integer enum and skips the converter", () => {
    const { root, context } = withEnums();
    const files = generateCSharpFiles(root, context);

    // System.Text.Json already writes the underlying number.
    expect(files["Priority.cs"]).toContain("Low = 1,");
    expect(files["Priority.cs"]).not.toContain("JsonStringEnumConverter");
  });

  it("writes each enum to its own file", () => {
    const { root, context } = withEnums();

    expect(Object.keys(generateCSharpFiles(root, context)).sort()).toEqual([
      "Pet.cs",
      "Priority.cs",
      "Status.cs",
    ]);
  });

  it("warns about values C# cannot round-trip, and only those", () => {
    const context = new TransformationContext();
    const root: ObjectNode = { kind: "object", name: "R", properties: [] };

    context.registerEnum({
      kind: "enum",
      name: "Grade",
      baseType: "string",
      members: [
        // Differs only by case, which the converter matches on read.
        { name: "Available", value: "available" },
        // Not an identifier at all; nothing before .NET 9 can express it.
        { name: "NA", value: "n/a" },
      ],
    });

    context.registerType(root);

    const diagnostics = cSharpGenerator.generate(root, context).diagnostics ?? [];

    expect(diagnostics.map((d) => d.code)).toEqual([
      "csharp/enum-value-unmappable",
    ]);

    expect(diagnostics[0]?.message).toContain('"n/a"');
    expect(diagnostics[0]?.message).not.toContain('"available"');
  });
});
