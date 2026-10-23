import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packagesDir = new URL("./packages/", import.meta.url);

/**
 * Maps every workspace package to its TypeScript source, derived from the
 * directory so the list cannot go stale when a package is added.
 *
 * Tests therefore run straight from source and `pnpm test` needs no prior
 * `pnpm build`. Production consumers resolve the built output through each
 * package's `exports` field instead.
 */
function workspaceAliases(): Record<string, string> {
  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [
      `@devbridge/${entry.name}`,
      fileURLToPath(new URL(`${entry.name}/src/index.ts`, packagesDir)),
    ]);

  return Object.fromEntries(entries) as Record<string, string>;
}

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
