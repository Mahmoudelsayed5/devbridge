import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Tests run straight from TypeScript source so that `pnpm test` does not
 * require a prior `pnpm build`. Production consumers resolve the built
 * output through each package's `exports` field instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@devbridge/core": packageSource("core"),
      "@devbridge/json-transformer": packageSource("json-transformer"),
      "@devbridge/typescript-transformer": packageSource(
        "typescript-transformer",
      ),
      "@devbridge/java-transformer": packageSource("java-transformer"),
      "@devbridge/go-transformer": packageSource("go-transformer"),
      "@devbridge/python-transformer": packageSource("python-transformer"),
      "@devbridge/csharp-transformer": packageSource("csharp-transformer"),
      "@devbridge/engine": packageSource("engine"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
