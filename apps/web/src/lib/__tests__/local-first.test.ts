import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The product promise is that a transformation never leaves the machine, and
 * the UI says so on screen. That claim is only as good as the code behind it,
 * so this guards it: no module that ships to the browser may reach the
 * network, and none may persist the user's input.
 */

const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));

const SHIPPED_ROOTS = [
  join(repoRoot, "apps", "web", "src"),
  join(repoRoot, "packages", "core", "src"),
  join(repoRoot, "packages", "engine", "src"),
  join(repoRoot, "packages", "json-transformer", "src"),
  join(repoRoot, "packages", "typescript-transformer", "src"),
  join(repoRoot, "packages", "java-transformer", "src"),
  join(repoRoot, "packages", "go-transformer", "src"),
  join(repoRoot, "packages", "python-transformer", "src"),
  join(repoRoot, "packages", "csharp-transformer", "src"),
];

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bsendBeacon\b/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  /\bimportScripts\s*\(/,
];

const STORAGE_PATTERNS = [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      // Test files are not shipped to the browser.
      if (entry !== "__tests__") {
        found.push(...sourceFiles(full));
      }

      continue;
    }

    if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

const files = SHIPPED_ROOTS.flatMap(sourceFiles);

describe("local-first guarantee", () => {
  it("finds the shipped sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("makes no network call from any shipped module", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");

      for (const pattern of NETWORK_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${file.replace(repoRoot, "")}: ${pattern.source}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("persists nothing the user pasted", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");

      for (const pattern of STORAGE_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${file.replace(repoRoot, "")}: ${pattern.source}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
