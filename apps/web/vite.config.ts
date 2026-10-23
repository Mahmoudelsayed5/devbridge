import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packagesDir = new URL("../../packages/", import.meta.url);

/**
 * Maps every workspace package to its TypeScript source.
 *
 * Derived from the directory rather than listed by hand: a hand-written list
 * silently goes stale the moment a package is added, and the failure only
 * shows up in a build that has no `dist` to fall back on. `tsconfig.json`
 * does the same job with a single `@devbridge/*` wildcard.
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
  // GitHub Pages serves a project site from /<repo>/, so asset URLs need that
  // prefix. Left as "/" everywhere else, which keeps `pnpm dev` and any
  // root-hosted deployment working unchanged.
  base: process.env["PAGES_BASE"] ?? "/",
  plugins: [react()],
  resolve: {
    // Aliased to source, so `pnpm dev` needs no prior `tsc -b` and edits to
    // the engine hot-reload in the browser.
    alias: workspaceAliases(),
  },
  server: {
    port: 5173,
  },
  build: {
    // The whole point is that transformation happens on the visitor's machine,
    // so the bundle must be self-contained: no runtime fetches, no CDN.
    target: "es2022",
    sourcemap: true,
  },
});
