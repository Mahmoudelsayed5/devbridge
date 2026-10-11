import { describe, expect, it } from "vitest";

import { buildGeneratorOptions, DEFAULT_OPTIONS, TARGETS } from "../options.js";
import { availableTargets, runTransform, validateInput } from "../transform.js";

const SAMPLE = JSON.stringify({
  id: 1,
  "user-name": "Mahmoud",
  address: { city: "Cairo" },
  orders: [{ total: 1 }, { total: 2, note: "x" }],
});

describe("runTransform", () => {
  it("reports an empty document as empty, not as an error", () => {
    const outcome = runTransform("   ", "typescript");

    expect(outcome.status).toBe("empty");
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.files).toEqual([]);
  });

  it("produces files and type names for a valid document", () => {
    const outcome = runTransform(SAMPLE, "typescript");

    expect(outcome.status).toBe("ok");
    expect(outcome.types).toEqual(["Root", "Address", "OrdersItem"]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.preview).toContain("export interface Root");
  });

  it("returns diagnostics instead of throwing on bad input", () => {
    const outcome = runTransform("{ not json", "typescript");

    expect(outcome.status).toBe("invalid");
    expect(outcome.diagnostics.length).toBeGreaterThan(0);
    expect(outcome.diagnostics[0]?.severity).toBe("error");
    expect(outcome.files).toEqual([]);
  });

  it("never returns an invalid status with no diagnostic to show", () => {
    for (const input of ["{ not json", '"a string"', "[]", "[1,2]"]) {
      const outcome = runTransform(input, "java");

      expect(outcome.status).toBe("invalid");
      expect(outcome.diagnostics.length).toBeGreaterThan(0);
      expect(outcome.diagnostics[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it("reports an unknown target as a diagnostic", () => {
    const outcome = runTransform(SAMPLE, "rust");

    expect(outcome.status).toBe("invalid");
    expect(outcome.diagnostics[0]?.message).toContain("Unknown target format");
  });

  it("applies a custom root name and ignores a blank one", () => {
    expect(runTransform(SAMPLE, "typescript", {}, "Payload").types[0]).toBe(
      "Payload",
    );

    expect(runTransform(SAMPLE, "typescript", {}, "   ").types[0]).toBe("Root");
  });

  it("emits one file per type for file-per-type targets", () => {
    const outcome = runTransform(SAMPLE, "java");

    expect(outcome.files.map((file) => file.path).sort()).toEqual([
      "Address.java",
      "OrdersItem.java",
      "Root.java",
    ]);
  });

  it("drives every registered target from the same input", () => {
    for (const target of availableTargets()) {
      const outcome = runTransform(SAMPLE, target.id);

      expect(outcome.status).toBe("ok");
      expect(outcome.files.length).toBeGreaterThan(0);
      expect(outcome.preview.length).toBeGreaterThan(0);
    }
  });
});

describe("validateInput", () => {
  it("is quiet for empty and valid input", () => {
    expect(validateInput("")).toEqual([]);
    expect(validateInput(SAMPLE)).toEqual([]);
  });

  it("locates a syntax error", () => {
    const diagnostics = validateInput('{\n  "a": 1,\n}');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("json/invalid-syntax");
  });
});

describe("buildGeneratorOptions", () => {
  it("only passes options the target understands", () => {
    const state = { ...DEFAULT_OPTIONS, packageName: "com.example" };

    // TypeScript has no package concept, so it must not receive one.
    expect(buildGeneratorOptions("typescript", state)).not.toHaveProperty(
      "packageName",
    );

    expect(buildGeneratorOptions("java", state)).toMatchObject({
      packageName: "com.example",
    });
  });

  it("omits blank text values rather than sending empty strings", () => {
    const options = buildGeneratorOptions("java", {
      ...DEFAULT_OPTIONS,
      packageName: "   ",
      style: "",
    });

    expect(options).not.toHaveProperty("packageName");
    expect(options).not.toHaveProperty("style");
  });

  it("maps the indent choice onto real whitespace", () => {
    const of = (indent: string) =>
      buildGeneratorOptions("typescript", { ...DEFAULT_OPTIONS, indent });

    expect(of("2")).toMatchObject({ indent: "  " });
    expect(of("4")).toMatchObject({ indent: "    " });
    expect(of("tab")).toMatchObject({ indent: "\t" });
    expect(of("default")).not.toHaveProperty("indent");
  });

  it("passes target specific switches through to their generator", () => {
    const state = { ...DEFAULT_OPTIONS, accessors: false, useRequired: false };

    expect(buildGeneratorOptions("java", state)).toMatchObject({
      accessors: false,
    });
    expect(buildGeneratorOptions("csharp", state)).toMatchObject({
      useRequired: false,
    });
    expect(buildGeneratorOptions("go", state)).not.toHaveProperty("accessors");
  });

  it("produces options every generator accepts end to end", () => {
    for (const [target, descriptor] of Object.entries(TARGETS)) {
      const options = buildGeneratorOptions(target, {
        ...DEFAULT_OPTIONS,
        packageName: "Example.Pkg",
        style: descriptor.styles?.[1]?.value ?? "",
        indent: "4",
        header: true,
      });

      const outcome = runTransform(SAMPLE, target, options);

      expect(outcome.status, `${target} failed`).toBe("ok");
    }
  });

  it("covers every registered target with a descriptor", () => {
    const registered = availableTargets().map((target) => target.id).sort();

    expect(Object.keys(TARGETS).sort()).toEqual(registered);
  });
});
