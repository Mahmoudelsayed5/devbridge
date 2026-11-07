#!/usr/bin/env node
/**
 * Prints one version's section of CHANGELOG.md, for release notes.
 *
 * The release workflow pipes this into `gh release create`, so a tag whose
 * version has no entry fails the release rather than publishing one with
 * empty or generated-from-commits notes. That is the useful failure: the
 * CHANGELOG is the thing a reader sees first, and a release is the one
 * moment it cannot be fixed quietly afterwards.
 *
 * Usage:
 *   node scripts/changelog-section.mjs 0.1.0
 *   node scripts/changelog-section.mjs v0.1.0   # a leading v is accepted
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const requested = process.argv[2];

if (requested === undefined) {
  console.error("usage: node scripts/changelog-section.mjs <version>");
  process.exit(2);
}

const version = requested.replace(/^v/, "");
const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);

// A version heading is `## [1.2.3] — date` or `## [1.2.3]`. The link
// definitions at the foot of the file start with `[` in column one and must
// not be mistaken for content.
const isVersionHeading = (line) => /^## \[[^\]]+\]/.test(line);
const headingVersion = (line) => /^## \[([^\]]+)\]/.exec(line)?.[1];

const start = lines.findIndex(
  (line) => isVersionHeading(line) && headingVersion(line) === version,
);

if (start === -1) {
  console.error(
    `CHANGELOG.md has no section for ${version}. Add one before tagging.`,
  );

  process.exit(1);
}

const rest = lines.slice(start + 1);
const nextHeading = rest.findIndex(isVersionHeading);
const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading))
  // Drop the link definitions that live at the foot of the file.
  .filter((line) => !/^\[[^\]]+\]: https?:\/\//.test(line))
  .join("\n")
  .trim();

if (body.length === 0) {
  console.error(`The ${version} section of CHANGELOG.md is empty.`);
  process.exit(1);
}

process.stdout.write(`${body}\n`);
