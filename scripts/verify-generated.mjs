#!/usr/bin/env node
/**
 * Compiles the generated output of every target with that language's real
 * toolchain.
 *
 * The unit tests assert on generated text; this asserts the text is actually
 * valid in the target language, which is a different and stronger claim. A
 * missing toolchain is reported as a skip, not a failure, so the script is
 * useful locally with whatever happens to be installed and strict in CI
 * where everything is.
 *
 * Usage:
 *   node scripts/verify-generated.mjs              # skip missing toolchains
 *   node scripts/verify-generated.mjs --strict      # missing toolchain = failure
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "bin.js");
const strict = process.argv.includes("--strict");

/**
 * Each source that can produce language models, with a fixture exercising it.
 *
 * Both are run through every target, because the two readings reach the
 * generators with different material. The OpenAPI one carries what inference
 * from JSON samples cannot: a declared integer width, a declared required
 * list, one type shared by two references, and recursion.
 */
const fixtures = [
  { name: "json", path: join(root, "fixtures", "kitchen-sink.json") },
  { name: "openapi", path: join(root, "fixtures", "kitchen-sink.openapi.yaml") },
];

// Every tool invoked here is a real executable, which CreateProcess and execvp
// both resolve from PATH, so no shell is needed (and none is used: passing
// args through a shell would require escaping them).
function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

/** True when `command` can be executed at all. */
function available(command, args = ["--version"]) {
  const result = run(command, args, root);

  return result.error === undefined && result.status === 0;
}

function generate(fixture, target, outDir, extra = []) {
  const result = run(
    process.execPath,
    [cli, "transform", fixture, "--to", target, "--out", outDir, "--quiet", ...extra],
    root,
  );

  if (result.status !== 0) {
    throw new Error(
      `devbridge transform --to ${target} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function workDir(name) {
  const dir = mkdtempSync(join(tmpdir(), `devbridge-${name}-`));

  mkdirSync(dir, { recursive: true });

  return dir;
}

const checks = [
  {
    target: "typescript",
    tool: "node",
    probe: () => true,
    verify(dir) {
      // tsc is a workspace dependency, so this always runs.
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify(
          { compilerOptions: { strict: true, noEmit: true, target: "ES2022" } },
          null,
          2,
        ),
      );

      const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

      return run(process.execPath, [tsc, "--project", dir], dir);
    },
  },
  {
    target: "java",
    tool: "javac",
    probe: () => available("javac", ["-version"]),
    verify(dir) {
      const sources = readdirSync(dir).filter((file) => file.endsWith(".java"));

      return run("javac", ["-Xlint:all", "-d", join(dir, "classes"), ...sources], dir);
    },
  },
  {
    target: "go",
    tool: "go",
    probe: () => available("go", ["version"]),
    verify(dir) {
      writeFileSync(join(dir, "go.mod"), "module devbridgeverify\n\ngo 1.24\n");

      const vet = run("go", ["vet", "./..."], dir);

      if (vet.status !== 0) {
        return vet;
      }

      // gofmt -l prints files that are not canonically formatted.
      const fmt = run("gofmt", ["-l", "."], dir);

      if (fmt.status === 0 && fmt.stdout.trim() !== "") {
        return { status: 1, stdout: `not gofmt-clean:\n${fmt.stdout}`, stderr: "" };
      }

      return vet;
    },
  },
  {
    target: "python",
    tool: "python3",
    probe: () => available("python3") || available("python"),
    verify(dir) {
      const python = available("python3") ? "python3" : "python";

      // get_type_hints resolves every postponed annotation, which proves no
      // generated annotation references an undefined or malformed name.
      writeFileSync(
        join(dir, "verify.py"),
        [
          "import dataclasses, os, sys, typing",
          "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))",
          "import models",
          "classes = [v for v in vars(models).values()",
          "           if dataclasses.is_dataclass(v)]",
          "assert classes, 'no dataclasses generated'",
          "for cls in classes:",
          "    hints = typing.get_type_hints(cls)",
          "    fields = {f.name for f in dataclasses.fields(cls)}",
          "    assert set(hints) == fields, (cls.__name__, hints, fields)",
          "print(f'resolved {len(classes)} dataclasses')",
          "",
        ].join("\n"),
      );

      const compiled = run(python, ["-m", "py_compile", join(dir, "models.py")], dir);

      if (compiled.status !== 0) {
        return compiled;
      }

      return run(python, [join(dir, "verify.py")], dir);
    },
  },
  {
    target: "csharp",
    tool: "dotnet",
    probe: () => available("dotnet"),
    verify(dir) {
      // Clear every package source: the project needs no NuGet packages, and
      // an unreachable feed should not turn into a hang.
      writeFileSync(
        join(dir, "nuget.config"),
        "<configuration><packageSources><clear /></packageSources></configuration>\n",
      );

      // Target the installed SDK's own major version: reference packs for an
      // older TFM would have to come from NuGet, which defeats the point of
      // an offline check.
      const sdk = run("dotnet", ["--version"], dir).stdout.trim();
      const major = sdk.split(".")[0];

      writeFileSync(
        join(dir, "verify.csproj"),
        [
          '<Project Sdk="Microsoft.NET.Sdk">',
          "  <PropertyGroup>",
          `    <TargetFramework>net${major}.0</TargetFramework>`,
          "    <Nullable>enable</Nullable>",
          "    <LangVersion>latest</LangVersion>",
          "    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>",
          "  </PropertyGroup>",
          "</Project>",
          "",
        ].join("\n"),
      );

      return run("dotnet", ["build", "--nologo", "-v", "quiet"], dir);
    },
  },
];

let passed = 0;
let failed = 0;
let skipped = 0;

for (const check of checks) {
  if (!check.probe()) {
    // Counted once per fixture so the totals still add up to the work planned.
    if (strict) {
      console.error(`FAIL ${check.target}: ${check.tool} not found (--strict)`);
      failed += fixtures.length;
    } else {
      console.log(`SKIP ${check.target}: ${check.tool} not found`);
      skipped += fixtures.length;
    }

    continue;
  }

  for (const fixture of fixtures) {
    const label = `${check.target} (${fixture.name})`;
    const dir = workDir(`${check.target}-${fixture.name}`);

    try {
      generate(fixture.path, check.target, dir);

      const result = check.verify(dir);

      if (result.status === 0) {
        passed += 1;
        console.log(`PASS ${label}`);
      } else {
        failed += 1;
        console.error(`FAIL ${label} (exit ${result.status})`);
        console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${label}: ${error.message}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

process.exitCode = failed > 0 ? 1 : 0;
