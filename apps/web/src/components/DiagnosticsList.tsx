import type { Diagnostic } from "@devbridge/core";

interface DiagnosticsListProps {
  readonly diagnostics: readonly Diagnostic[];
  readonly typeCount: number;
  /** What the count refers to: "type" for JSON, "table" for SQL. */
  readonly noun: string;
  readonly status: "empty" | "ok" | "invalid";
}

function position(diagnostic: Diagnostic): string | undefined {
  if (diagnostic.line === undefined) {
    return undefined;
  }

  return `${diagnostic.line}:${diagnostic.column ?? 1}`;
}

export function DiagnosticsList({
  diagnostics,
  typeCount,
  noun,
  status,
}: DiagnosticsListProps): React.JSX.Element | null {
  if (status === "empty") {
    return null;
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const notes = diagnostics.filter((d) => d.severity !== "error");

  return (
    <div className="diagnostics" role="status" aria-live="polite">
      {status === "ok" && errors.length === 0 ? (
        <p className="diag-ok">
          Valid — {typeCount} {typeCount === 1 ? noun : `${noun}s`} found
        </p>
      ) : null}

      {[...errors, ...notes].map((diagnostic, index) => (
        <p
          key={`${diagnostic.code}-${index}`}
          className={`diag diag-${diagnostic.severity}`}
        >
          {position(diagnostic) !== undefined ? (
            <span className="diag-pos">{position(diagnostic)}</span>
          ) : null}

          <span className="diag-msg">{diagnostic.message}</span>

          {diagnostic.hint !== undefined ? (
            <span className="diag-hint">{diagnostic.hint}</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}
