import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = new URL("../", import.meta.url);
const packagesDir = new URL("../../packages/", here);

/**
 * Maps every workspace package to its TypeScript source, derived from the
 * directory so the list cannot go stale when a package is added — the same
 * approach the web app and the test runner use.
 */
function workspaceAliases() {
  return Object.fromEntries(
    readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        `@devbridge/${entry.name}`,
        fileURLToPath(new URL(`${entry.name}/src/index.ts`, packagesDir)),
      ]),
  );
}

/**
 * The VS Code extension host loads a single CommonJS file and provides
 * `vscode` itself, so that one import stays external while everything else —
 * the engine and its dependencies — is bundled in. The result has no runtime
 * dependencies, which is why the extension can be packaged with
 * `--no-dependencies`.
 */
await build({
  entryPoints: [fileURLToPath(new URL("src/extension.ts", here))],
  outfile: fileURLToPath(new URL("dist/extension.cjs", here)),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  alias: workspaceAliases(),
  sourcemap: true,
  minify: true,
  logLevel: "info",
});
