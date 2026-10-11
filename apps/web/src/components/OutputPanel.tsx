import { useEffect, useState } from "react";

import type { GeneratedFile } from "@devbridge/core";

import { copyText, downloadText, downloadZip } from "../lib/download.js";

interface OutputPanelProps {
  readonly files: readonly GeneratedFile[];
  readonly preview: string;
  readonly targetLabel: string;
  readonly busy: boolean;
}

export function OutputPanel({
  files,
  preview,
  targetLabel,
  busy,
}: OutputPanelProps): React.JSX.Element {
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // A selection left over from another target simply falls back to the first
  // file, so no effect is needed to reconcile it.
  const active =
    files.find((file) => file.path === activePath) ?? files[0] ?? undefined;

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => {
      setCopied(false);
    }, 1600);

    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const shown = active?.content ?? preview;
  const multiFile = files.length > 1;

  async function handleCopy(): Promise<void> {
    setCopied(await copyText(shown));
  }

  return (
    <section className="panel" aria-label={`${targetLabel} output`}>
      <header className="panel-head">
        <h2>Output</h2>

        <div className="panel-actions">
          <button
            type="button"
            onClick={() => {
              void handleCopy();
            }}
            disabled={shown.length === 0}
          >
            {copied ? "Copied" : "Copy"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (active !== undefined) {
                downloadText(active.path, active.content);
              }
            }}
            disabled={active === undefined}
          >
            Download
          </button>

          {multiFile ? (
            <button
              type="button"
              onClick={() => {
                downloadZip("devbridge-output.zip", files);
              }}
            >
              Download all ({files.length})
            </button>
          ) : null}
        </div>
      </header>

      {multiFile ? (
        <div className="file-tabs" role="tablist" aria-label="Generated files">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              role="tab"
              aria-selected={file.path === active?.path}
              className={file.path === active?.path ? "tab tab-active" : "tab"}
              onClick={() => {
                setActivePath(file.path);
              }}
            >
              {file.path}
            </button>
          ))}
        </div>
      ) : null}

      <pre className={busy ? "output output-busy" : "output"}>
        <code>{shown}</code>
      </pre>

      <footer className="panel-foot">
        <span>{targetLabel}</span>
        <span>
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </footer>
    </section>
  );
}
