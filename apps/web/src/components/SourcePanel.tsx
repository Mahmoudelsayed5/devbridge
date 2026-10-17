import { useId, useRef } from "react";

interface SourceOption {
  readonly id: string;
  readonly label: string;
}

interface SourcePanelProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onLoadSample: () => void;
  readonly sources: readonly SourceOption[];
  readonly source: string;
  readonly onSelectSource: (source: string) => void;
  /** Accept list for the file picker, e.g. ".sql,.ddl". */
  readonly accept: string;
  readonly lineCount: number;
  readonly byteCount: number;
}

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  json: 'Paste JSON here, for example {"user": {"id": 1}}',
  sql: "Paste CREATE TABLE statements here",
};

export function SourcePanel({
  value,
  onChange,
  onLoadSample,
  sources,
  source,
  onSelectSource,
  accept,
  lineCount,
  byteCount,
}: SourcePanelProps): React.JSX.Element {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    // Read locally; the file never leaves the machine.
    onChange(await file.text());

    // Reset so selecting the same file again still fires a change.
    event.target.value = "";
  }

  const current = sources.find((item) => item.id === source);

  return (
    <section className="panel" aria-labelledby={`${inputId}-heading`}>
      <header className="panel-head">
        <h2 id={`${inputId}-heading`}>Source</h2>

        <div className="panel-actions">
          <label className="source-select">
            <span className="visually-hidden">Source format</span>
            <select
              value={source}
              onChange={(event) => {
                onSelectSource(event.target.value);
              }}
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={onLoadSample}>
            Load sample
          </button>

          <button type="button" onClick={() => fileInput.current?.click()}>
            Open file…
          </button>

          <button
            type="button"
            onClick={() => {
              onChange("");
            }}
            disabled={value.length === 0}
          >
            Clear
          </button>

          <input
            ref={fileInput}
            type="file"
            accept={`${accept},text/plain`}
            hidden
            onChange={(event) => {
              void handleFile(event);
            }}
          />
        </div>
      </header>

      <textarea
        className="editor"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={PLACEHOLDERS[source] ?? "Paste your artifact here"}
        aria-label={`${current?.label ?? "Source"} source`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />

      <footer className="panel-foot">
        <span>
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <span>{byteCount.toLocaleString()} bytes</span>
      </footer>
    </section>
  );
}
