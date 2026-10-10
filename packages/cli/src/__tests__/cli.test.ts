import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CliIo } from "../index.js";
import { run } from "../index.js";

const SAMPLE = JSON.stringify({ user: { id: 1, tags: ["a"] } });

interface Captured {
  readonly io: CliIo;
  readonly out: string[];
  readonly err: string[];
}

function capture(stdin = ""): Captured {
  const out: string[] = [];
  const err: string[] = [];

  return {
    out,
    err,
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      readStdin: () => Promise.resolve(stdin),
    },
  };
}

const temporaries: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "devbridge-cli-"));

  temporaries.push(directory);

  return directory;
}

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop() as string;

    await rm(directory, { recursive: true, force: true });
  }
});

describe("devbridge cli", () => {
  it("prints usage and fails when no command is given", async () => {
    const captured = capture();

    expect(await run([], captured.io)).toBe(2);
    expect(captured.out.join("\n")).toContain("Usage:");
  });

  it("prints usage for --help", async () => {
    const captured = capture();

    expect(await run(["--help"], captured.io)).toBe(0);
  });

  it("lists sources and targets", async () => {
    const captured = capture();

    expect(await run(["formats"], captured.io)).toBe(0);

    const text = captured.out.join("\n");

    expect(text).toContain("json");
    expect(text).toContain("typescript");
    expect(text).toContain("csharp");
  });

  it("transforms stdin to the chosen target", async () => {
    const captured = capture(SAMPLE);

    expect(
      await run(["transform", "-", "--from", "json", "--to", "typescript"], captured.io),
    ).toBe(0);

    expect(captured.out.join("\n")).toContain("export interface User");
  });

  it("infers the source format from the file extension", async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, "payload.json");

    await writeFile(file, SAMPLE, "utf8");

    const captured = capture();

    expect(await run(["transform", file, "--to", "go"], captured.io)).toBe(0);
    expect(captured.out.join("\n")).toContain("package models");
  });

  it("writes generated files into --out", async () => {
    const directory = await temporaryDirectory();
    const out = join(directory, "generated");
    const captured = capture(SAMPLE);

    expect(
      await run(
        [
          "transform",
          "-",
          "--from",
          "json",
          "--to",
          "java",
          "--out",
          out,
          "--package",
          "com.example",
        ],
        captured.io,
      ),
    ).toBe(0);

    const rootJava = await readFile(join(out, "Root.java"), "utf8");

    expect(rootJava).toContain("package com.example;");
    expect(rootJava).toContain("public class Root");
    expect(captured.out.join("\n")).toContain("Root.java");
  });

  it("passes --root through to the parser", async () => {
    const captured = capture(SAMPLE);

    expect(
      await run(
        ["transform", "-", "--from", "json", "--to", "typescript", "--root", "Payload"],
        captured.io,
      ),
    ).toBe(0);

    expect(captured.out.join("\n")).toContain("interface Payload");
  });

  it("validates a good artifact", async () => {
    const captured = capture(SAMPLE);

    expect(await run(["validate", "-", "--from", "json"], captured.io)).toBe(0);
    expect(captured.out.join("\n")).toContain("valid json");
  });

  it("fails validation with a located diagnostic", async () => {
    const captured = capture("{ broken");

    expect(await run(["validate", "-", "--from", "json"], captured.io)).toBe(1);
    expect(captured.err.join("\n")).toContain("json/invalid-syntax");
  });

  it("explains an unknown target", async () => {
    const captured = capture(SAMPLE);

    expect(
      await run(["transform", "-", "--from", "json", "--to", "rust"], captured.io),
    ).toBe(1);

    expect(captured.err.join("\n")).toContain("Unknown target format");
  });

  it("asks for --from when the extension says nothing", async () => {
    const captured = capture(SAMPLE);

    expect(await run(["transform", "-", "--to", "go"], captured.io)).toBe(1);
    expect(captured.err.join("\n")).toContain("--from");
  });

  it("rejects an unknown command", async () => {
    const captured = capture();

    expect(await run(["explode"], captured.io)).toBe(2);
    expect(captured.err.join("\n")).toContain('Unknown command "explode"');
  });

  it("rejects a bad --indent", async () => {
    const captured = capture(SAMPLE);

    expect(
      await run(
        ["transform", "-", "--from", "json", "--to", "typescript", "--indent", "nope"],
        captured.io,
      ),
    ).toBe(1);

    expect(captured.err.join("\n")).toContain("Invalid --indent");
  });
});
