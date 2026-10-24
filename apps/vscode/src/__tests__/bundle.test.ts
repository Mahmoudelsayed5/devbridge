import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Loads the real bundled extension with a stubbed `vscode` module.
 *
 * A VS Code extension can only be exercised inside an editor, which is not
 * something CI can do cheaply. But most of what goes wrong is cheaper than
 * that: a bundle that does not load, a missing export, a command the manifest
 * promises and the code never registers. Faking the one module the host
 * provides catches all three without an editor.
 *
 * The bundle is produced by `pnpm --filter devbridge-vscode build`; when it is
 * absent these checks skip rather than fail, so `pnpm test` works on a fresh
 * clone.
 */

const bundlePath = fileURLToPath(
  new URL("../../dist/extension.cjs", import.meta.url),
);

const manifestPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

const require = createRequire(import.meta.url);

interface Registered {
  readonly commands: string[];
}

function loadExtension(): {
  activate: (context: unknown) => void;
  deactivate: () => void;
  registered: Registered;
} {
  const registered: Registered = { commands: [] };

  // The extension host supplies `vscode`; esbuild left it external, so the
  // only thing standing between the bundle and running is this stub.
  const stub = {
    commands: {
      registerCommand(id: string) {
        registered.commands.push(id);

        return { dispose(): void {} };
      },
    },
    window: {
      activeTextEditor: undefined,
      showQuickPick: async () => undefined,
      showErrorMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showTextDocument: async () => undefined,
      setStatusBarMessage: () => ({ dispose(): void {} }),
    },
    workspace: {
      openTextDocument: async () => ({}),
    },
  };

  const Module = require("node:module") as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };

  const original = Module._load;

  Module._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    return request === "vscode"
      ? stub
      : original.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(bundlePath)];

    const loaded = require(bundlePath) as {
      activate: (context: unknown) => void;
      deactivate: () => void;
    };

    return { ...loaded, registered };
  } finally {
    Module._load = original;
  }
}

const built = existsSync(bundlePath);

describe.skipIf(!built)("bundled extension", () => {
  it("loads as CommonJS with vscode as its only external", () => {
    expect(() => loadExtension()).not.toThrow();
  });

  it("exports the activate and deactivate entry points", () => {
    const extension = loadExtension();

    expect(typeof extension.activate).toBe("function");
    expect(typeof extension.deactivate).toBe("function");
  });

  it("registers exactly the commands the manifest declares", () => {
    const extension = loadExtension();
    const subscriptions: unknown[] = [];

    extension.activate({ subscriptions });

    const manifest = require(manifestPath) as {
      contributes: { commands: { command: string }[] };
    };

    const declared = manifest.contributes.commands
      .map((entry) => entry.command)
      .sort();

    expect([...extension.registered.commands].sort()).toEqual(declared);

    // Everything registered must be disposed with the extension.
    expect(subscriptions).toHaveLength(declared.length);
  });

  it("deactivates without throwing", () => {
    const extension = loadExtension();

    expect(() => extension.deactivate()).not.toThrow();
  });
});
