import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * The workspace packages are aliased to their TypeScript source rather than
 * their built `dist`, so `pnpm dev` needs no prior `tsc -b` and edits to the
 * engine hot-reload in the browser.
 */
export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so asset URLs need that
  // prefix. Left as "/" everywhere else, which keeps `pnpm dev` and any
  // root-hosted deployment working unchanged.
  base: process.env["PAGES_BASE"] ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@devbridge/core": packageSource("core"),
      "@devbridge/engine": packageSource("engine"),
      "@devbridge/json-transformer": packageSource("json-transformer"),
      "@devbridge/typescript-transformer": packageSource("typescript-transformer"),
      "@devbridge/java-transformer": packageSource("java-transformer"),
      "@devbridge/go-transformer": packageSource("go-transformer"),
      "@devbridge/python-transformer": packageSource("python-transformer"),
      "@devbridge/csharp-transformer": packageSource("csharp-transformer"),
    },
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
