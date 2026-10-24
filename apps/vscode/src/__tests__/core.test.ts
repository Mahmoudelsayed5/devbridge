import { describe, expect, it } from "vitest";

import {
  describeResult,
  inferSource,
  languageForTarget,
  noteworthy,
  runTransform,
  runValidate,
  sourceChoices,
  TARGET_LANGUAGES,
  targetChoices,
} from "../core.js";

const JSON_SAMPLE = JSON.stringify({ user: { id: 1, name: "Mahmoud" } });

const SQL_SAMPLE = `
CREATE TABLE users (id INT PRIMARY KEY);
CREATE TABLE orders (id INT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id));
`;

const OPENAPI_SAMPLE = `
openapi: 3.0.3
info: { title: Demo, version: "1.0" }
servers: [{ url: "https://api.example.com" }]
paths:
  /things:
    get: { summary: List things, responses: { "200": { description: OK } } }
`;

describe("inferSource", () => {
  it("prefers the editor language mode", () => {
    expect(inferSource("json", "whatever.txt")).toBe("json");
    expect(inferSource("jsonc", undefined)).toBe("json");
    expect(inferSource("sql", undefined)).toBe("sql");
    expect(inferSource("yaml", undefined)).toBe("openapi");
  });

  it("falls back to the file extension", () => {
    // VS Code calls a .ddl file plain text, so the extension is all there is.
    expect(inferSource("plaintext", "schema.ddl")).toBe("sql");
    expect(inferSource("plaintext", "api.yml")).toBe("openapi");
    expect(inferSource(undefined, "payload.json")).toBe("json");
  });

  it("is case insensitive about extensions", () => {
    expect(inferSource("plaintext", "SCHEMA.SQL")).toBe("sql");
  });

  it("returns undefined when it cannot tell, rather than guessing", () => {
    expect(inferSource("plaintext", "notes.txt")).toBeUndefined();
    expect(inferSource(undefined, undefined)).toBeUndefined();
    expect(inferSource("markdown", "README.md")).toBeUndefined();
  });
});

describe("languageForTarget", () => {
  it("maps each target onto an editor language", () => {
    expect(languageForTarget("typescript")).toBe("typescript");
    expect(languageForTarget("csharp")).toBe("csharp");
    expect(languageForTarget("postman")).toBe("json");
    expect(languageForTarget("mermaid")).toBe("markdown");
  });

  it("falls back to plain text for anything unknown", () => {
    expect(languageForTarget("klingon")).toBe("plaintext");
  });

  it("has a considered mapping for every registered target", () => {
    // Some targets legitimately map to plaintext — VS Code has no language id
    // for DBML — so the check is that a decision was *made*, not that it was
    // a particular one. A target added without one would fall through here.
    for (const source of sourceChoices()) {
      for (const target of targetChoices(source.id)) {
        expect(
          Object.keys(TARGET_LANGUAGES),
          `${target.id} has no entry in TARGET_LANGUAGES`,
        ).toContain(target.id);
      }
    }
  });
});

describe("choices", () => {
  it("lists every source with its extensions", () => {
    expect(sourceChoices().map((choice) => choice.id)).toEqual([
      "json",
      "sql",
      "openapi",
    ]);

    expect(sourceChoices()[1]?.detail).toBe(".sql, .ddl");
  });

  it("offers only targets compatible with the source", () => {
    expect(targetChoices("json").map((choice) => choice.id)).toEqual([
      "typescript",
      "java",
      "go",
      "python",
      "csharp",
    ]);

    expect(targetChoices("sql").map((choice) => choice.id)).toEqual([
      "mermaid",
      "dbml",
    ]);

    expect(targetChoices("openapi").map((choice) => choice.id)).toEqual([
      "postman",
    ]);
  });
});

describe("runTransform", () => {
  it("transforms every source into each of its targets", () => {
    const inputs: Record<string, string> = {
      json: JSON_SAMPLE,
      sql: SQL_SAMPLE,
      openapi: OPENAPI_SAMPLE,
    };

    for (const source of sourceChoices()) {
      for (const target of targetChoices(source.id)) {
        const outcome = runTransform(
          inputs[source.id] as string,
          source.id,
          target.id,
        );

        expect(outcome.ok, `${source.id} -> ${target.id}`).toBe(true);

        if (outcome.ok) {
          expect(outcome.files.length).toBeGreaterThan(0);
          expect(outcome.preview.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("reports an empty selection as a message, not an exception", () => {
    const outcome = runTransform("   ", "json", "typescript");

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.message).toContain("empty");
    }
  });

  it("never throws on a malformed document", () => {
    for (const input of ["{ broken", "SELECT 1", "not: openapi"]) {
      for (const source of ["json", "sql", "openapi"]) {
        expect(() => runTransform(input, source, "typescript")).not.toThrow();
      }
    }
  });

  it("surfaces a cross-family pairing as a readable message", () => {
    const outcome = runTransform(JSON_SAMPLE, "json", "mermaid");

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.message).toContain("cannot read");
    }
  });

  it("reports a parse failure with its diagnostic", () => {
    const outcome = runTransform("{ broken", "json", "typescript");

    expect(outcome.ok).toBe(false);

    if (!outcome.ok) {
      expect(outcome.diagnostics[0]?.code).toBe("json/invalid-syntax");
    }
  });
});

describe("runValidate", () => {
  it("accepts a good document", () => {
    expect(runValidate(JSON_SAMPLE, "json")).toEqual({
      ok: true,
      message: "Valid json.",
    });
  });

  it("reports the located first error", () => {
    const summary = runValidate('{\n  "a": 1,\n}', "json");

    expect(summary.ok).toBe(false);
    expect(summary.message).toContain("json/invalid-syntax");
  });

  it("mentions notes when the document parses with warnings", () => {
    const summary = runValidate(
      "CREATE TABLE orders (user_id INT REFERENCES users(id));",
      "sql",
    );

    expect(summary.ok).toBe(true);
    expect(summary.message).toContain("1 note");
  });

  it("treats an empty document as invalid", () => {
    expect(runValidate("", "json").ok).toBe(false);
  });
});

describe("describeResult and noteworthy", () => {
  it("summarises what was produced", () => {
    const outcome = runTransform(JSON_SAMPLE, "json", "java");

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(describeResult(outcome, "java")).toBe("2 types, 2 files");
    }
  });

  it("counts endpoints rather than types for an API target", () => {
    const outcome = runTransform(OPENAPI_SAMPLE, "openapi", "postman");

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(describeResult(outcome, "postman")).toBe("1 endpoint, 1 file");
    }
  });

  it("hides informational diagnostics but keeps warnings", () => {
    expect(
      noteworthy([
        { severity: "info", code: "a", message: "x" },
        { severity: "warning", code: "b", message: "y" },
      ]).map((diagnostic) => diagnostic.code),
    ).toEqual(["b"]);
  });
});
