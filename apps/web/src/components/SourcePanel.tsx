import { useId, useRef } from "react";

interface SourcePanelProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onLoadSample: () => void;
  readonly lineCount: number;
  readonly byteCount: number;
}

export function SourcePanel({
  value,
  onChange,
  onLoadSample,
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

  return (
    <section className="panel" aria-labelledby={`${inputId}-heading`}>
      <header className="panel-head">
        <h2 id={`${inputId}-heading`}>Source</h2>

        <div className="panel-actions">
          <span className="format-tag">JSON</span>

          <button type="button" onClick={onLoadSample}>
            Load sample
          </button>

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
          >
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
            accept=".json,application/json,text/plain"
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
        placeholder='Paste JSON here, for example {"user": {"id": 1}}'
        aria-label="JSON source"
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
