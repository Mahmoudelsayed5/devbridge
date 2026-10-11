import { useMemo, useState } from "react";

import { DiagnosticsList } from "./components/DiagnosticsList.js";
import { OptionsPanel } from "./components/OptionsPanel.js";
import { OutputPanel } from "./components/OutputPanel.js";
import { SourcePanel } from "./components/SourcePanel.js";
import {
  buildGeneratorOptions,
  DEFAULT_OPTIONS,
  defaultJsonAnnotations,
  TARGETS,
  type OptionState,
} from "./lib/options.js";
import { SAMPLE_JSON } from "./lib/sample.js";
import { availableTargets, runTransform } from "./lib/transform.js";
import { useDebounced } from "./lib/useDebounced.js";

const targets = availableTargets();

export function App(): React.JSX.Element {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState(targets[0]?.id ?? "typescript");
  const [options, setOptions] = useState<OptionState>(DEFAULT_OPTIONS);

  const debouncedSource = useDebounced(source);
  const busy = debouncedSource !== source;

  const descriptor = TARGETS[target];

  const outcome = useMemo(
    () =>
      runTransform(
        debouncedSource,
        target,
        buildGeneratorOptions(target, options),
        options.rootName,
      ),
    [debouncedSource, target, options],
  );

  function selectTarget(next: string): void {
    setTarget(next);

    // Each generator has its own default for annotations and shape; reset the
    // controls so the panel keeps matching what the generator actually does.
    setOptions((current) => ({
      ...current,
      style: "",
      jsonAnnotations: defaultJsonAnnotations(next),
    }));
  }

  const lineCount = source.length === 0 ? 0 : source.split("\n").length;
  const byteCount = new TextEncoder().encode(source).length;

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <h1>DevBridge</h1>
          <p>Turn an artifact you have into the one you need next.</p>
        </div>

        <p className="local-badge" title="No network request is made for any transformation">
          Runs entirely in your browser. Nothing is uploaded or stored.
        </p>
      </header>

      <main className="columns">
        <div className="column">
          <SourcePanel
            value={source}
            onChange={setSource}
            onLoadSample={() => {
              setSource(SAMPLE_JSON);
            }}
            lineCount={lineCount}
            byteCount={byteCount}
          />

          <DiagnosticsList
            diagnostics={outcome.diagnostics}
            typeCount={outcome.types.length}
            status={outcome.status}
          />
        </div>

        <div className="column">
          <div className="target-row" role="group" aria-label="Target format">
            {targets.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === target ? "target target-active" : "target"}
                aria-pressed={item.id === target}
                onClick={() => {
                  selectTarget(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <OptionsPanel
            descriptor={descriptor}
            state={options}
            onChange={(patch) => {
              setOptions((current) => ({ ...current, ...patch }));
            }}
          />

          <OutputPanel
            files={outcome.files}
            preview={outcome.preview}
            targetLabel={descriptor?.label ?? target}
            busy={busy}
          />
        </div>
      </main>

      <footer className="colophon">
        <span>
          Source → Parser → Shared IR → Generator → Target
        </span>
        <span>
          {outcome.types.length > 0
            ? outcome.types.join(" · ")
            : "Paste or load a JSON document to begin"}
        </span>
      </footer>
    </div>
  );
}
