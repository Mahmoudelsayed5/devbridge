export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  /** Zero-based character offset into the source text. */
  readonly offset?: number;
  /** One-based line number. */
  readonly line?: number;
  /** One-based column number. */
  readonly column?: number;
  /** Dotted path into the artifact, for example `users[0].profile`. */
  readonly path?: string;
}

export interface Diagnostic extends SourceLocation {
  readonly severity: DiagnosticSeverity;
  /** Stable machine-readable code, for example `json/invalid-syntax`. */
  readonly code: string;
  readonly message: string;
  /** Optional actionable hint shown under the message. */
  readonly hint?: string;
}

/** Thrown when an artifact cannot be turned into IR at all. */
export class TransformationError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.name = "TransformationError";
    this.diagnostics = diagnostics;
  }
}

/** Converts a character offset into a one-based line/column pair. */
export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");

  return {
    line: lines.length,
    column: (lines[lines.length - 1] as string).length + 1,
  };
}

/** Renders a diagnostic as a single human-readable line. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const position =
    diagnostic.line === undefined
      ? ""
      : `${diagnostic.line}:${diagnostic.column ?? 1} `;

  const hint = diagnostic.hint === undefined ? "" : ` (${diagnostic.hint})`;

  return `${position}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${hint}`;
}
