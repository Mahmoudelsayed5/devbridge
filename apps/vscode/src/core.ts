/**
 * Everything the extension does that is not a VS Code API call.
 *
 * `extension.ts` is deliberately thin glue around this file, because the
 * `vscode` module only exists inside a running editor: anything that imports
 * it cannot be unit tested. Keeping the decisions here means the parts that
 * can be wrong are the parts that are covered.
 */

import type { Diagnostic, GeneratedFile } from "@devbridge/core";
import { TransformationError, formatDiagnostic } from "@devbridge/core";
import {
  listSources,
  targetsFor,
  transform,
  validate,
} from "@devbridge/engine";

/** VS Code language ids that map onto a DevBridge source format. */
const LANGUAGE_SOURCES: Readonly<Record<string, string>> = {
  json: "json",
  jsonc: "json",
  sql: "sql",
  yaml: "openapi",
  yml: "openapi",
};

/** File extensions, used when the language id is unhelpful (plaintext). */
const EXTENSION_SOURCES: Readonly<Record<string, string>> = {
  json: "json",
  sql: "sql",
  ddl: "sql",
  yaml: "openapi",
  yml: "openapi",
  openapi: "openapi",
};

/**
 * The language id to open each result under.
 *
 * Unknown ids fall back to plain text in VS Code rather than failing, but
 * being explicit keeps syntax highlighting correct where an id exists.
 */
export const TARGET_LANGUAGES: Readonly<Record<string, string>> = {
  typescript: "typescript",
  java: "java",
  go: "go",
  python: "python",
  csharp: "csharp",
  postman: "json",
  mermaid: "markdown",
  dbml: "plaintext",
};

export function languageForTarget(target: string): string {
  return TARGET_LANGUAGES[target] ?? "plaintext";
}

function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");

  return dot === -1 ? undefined : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Works out which source format a document is.
 *
 * The language id is tried first because it is what the user sees in the
 * status bar, and it is correct even for an unsaved buffer. The file
 * extension is the fallback, which matters for a `.ddl` file VS Code calls
 * plain text.
 */
export function inferSource(
  languageId?: string,
  fileName?: string,
): string | undefined {
  const byLanguage =
    languageId === undefined ? undefined : LANGUAGE_SOURCES[languageId];

  if (byLanguage !== undefined) {
    return byLanguage;
  }

  const extension = fileName === undefined ? undefined : extensionOf(fileName);

  return extension === undefined ? undefined : EXTENSION_SOURCES[extension];
}

export interface SourceChoice {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** The source list offered when a document's format cannot be inferred. */
export function sourceChoices(): readonly SourceChoice[] {
  return listSources().map((source) => ({
    id: source.id,
    label: source.label,
    detail: source.extensions.map((extension) => `.${extension}`).join(", "),
  }));
}

export interface TargetChoice {
  readonly id: string;
  readonly label: string;
}

export function targetChoices(source: string): readonly TargetChoice[] {
  return targetsFor(source).map((target) => ({
    id: target.id,
    label: target.label,
  }));
}

export type TransformOutcome =
  | {
      readonly ok: true;
      readonly files: readonly GeneratedFile[];
      readonly preview: string;
      readonly language: string;
      readonly diagnostics: readonly Diagnostic[];
      readonly names: readonly string[];
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Runs a transformation, reporting failure as data.
 *
 * An editor command must never surface a stack trace, so a bad document is a
 * message to show rather than an exception to escape into the extension host.
 */
export function runTransform(
  text: string,
  source: string,
  target: string,
): TransformOutcome {
  if (text.trim().length === 0) {
    return {
      ok: false,
      message: "Nothing to transform: the selection is empty.",
      diagnostics: [],
    };
  }

  try {
    const result = transform({ input: text, source, target });

    return {
      ok: true,
      files: result.files,
      preview: result.preview,
      language: languageForTarget(target),
      diagnostics: result.diagnostics,
      names: result.names,
    };
  } catch (error) {
    if (error instanceof TransformationError) {
      return {
        ok: false,
        message: error.message,
        diagnostics: error.diagnostics,
      };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: [],
    };
  }
}

export interface ValidationSummary {
  readonly ok: boolean;
  readonly message: string;
}

/** Validates a document and summarises the result in one line. */
export function runValidate(text: string, source: string): ValidationSummary {
  if (text.trim().length === 0) {
    return { ok: false, message: "Nothing to validate: the document is empty." };
  }

  let diagnostics: readonly Diagnostic[];

  try {
    diagnostics = validate(text, source);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (errors.length > 0) {
    return { ok: false, message: formatDiagnostic(errors[0] as Diagnostic) };
  }

  const warnings = diagnostics.length;

  return {
    ok: true,
    message:
      warnings === 0
        ? `Valid ${source}.`
        : `Valid ${source}, with ${warnings} note${warnings === 1 ? "" : "s"}.`,
  };
}

/** One line summarising what a successful transformation produced. */
export function describeResult(
  outcome: Extract<TransformOutcome, { ok: true }>,
  target: string,
): string {
  const count = outcome.names.length;
  const noun = target === "postman" ? "endpoint" : "type";

  const parts = [
    `${count} ${count === 1 ? noun : `${noun}s`}`,
    `${outcome.files.length} file${outcome.files.length === 1 ? "" : "s"}`,
  ];

  return parts.join(", ");
}

/** Problems worth showing the user after a successful transformation. */
export function noteworthy(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.severity !== "info",
  );
}
