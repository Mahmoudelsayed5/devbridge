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
import { SAMPLES } from "./lib/sample.js";
import {
  availableSources,
  runTransform,
  targetsForSource,
} from "./lib/transform.js";
import { useDebounced } from "./lib/useDebounced.js";

const sources = availableSources();

export function App(): React.JSX.Element {
  const [source, setSource] = useState(sources[0]?.id ?? "json");
  const [text, setText] = useState("");
  const [target, setTarget] = useState(
    targetsForSource(sources[0]?.id ?? "json")[0]?.id ?? "typescript",
  );
  const [options, setOptions] = useState<OptionState>(DEFAULT_OPTIONS);

  const debouncedText = useDebounced(text);
  const busy = debouncedText !== text;

  const targets = useMemo(() => targetsForSource(source), [source]);
  const descriptor = TARGETS[target];

  const outcome = useMemo(
    () =>
      runTransform(
        debouncedText,
        target,
        buildGeneratorOptions(target, options),
        options.rootName,
        source,
      ),
    [debouncedText, target, options, source],
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

  function selectSource(next: string): void {
    if (next === source) {
      return;
    }

    setSource(next);
    setText("");

    // The old target belongs to the other IR family and cannot read this one.
    const first = targetsForSource(next)[0]?.id;

    if (first !== undefined) {
      selectTarget(first);
    }
  }

  const currentSource = sources.find((item) => item.id === source);
  const lineCount = text.length === 0 ? 0 : text.split("\n").length;
  const byteCount = new TextEncoder().encode(text).length;

  // What the discovered-name count refers to, per source family.
  const NOUNS: Readonly<Record<string, string>> = {
    sql: "table",
    openapi: "endpoint",
  };

  const noun = NOUNS[source] ?? "type";

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <h1>DevBridge</h1>
          <p>Turn an artifact you have into the one you need next.</p>
        </div>

        <p
          className="local-badge"
          title="No network request is made for any transformation"
        >
          Runs entirely in your browser. Nothing is uploaded or stored.
        </p>
      </header>

      <main className="columns">
        <div className="column">
          <SourcePanel
            value={text}
            onChange={setText}
            onLoadSample={() => {
              setText(SAMPLES[source] ?? "");
            }}
            sources={sources}
            source={source}
            onSelectSource={selectSource}
            accept={currentSource?.accept ?? ""}
            lineCount={lineCount}
            byteCount={byteCount}
          />

          <DiagnosticsList
            diagnostics={outcome.diagnostics}
            typeCount={outcome.types.length}
            noun={noun}
            status={outcome.status}
          />
        </div>

        <div className="column">
          <div className="target-row" role="group" aria-label="Target format">
            {targets.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === target ? "target target-active" : "target"
                }
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
        <span>Source → Parser → Shared IR → Generator → Target</span>
        <span>
          {outcome.types.length > 0
            ? outcome.types.join(" · ")
            : `Paste or load a ${currentSource?.label ?? ""} document to begin`}
        </span>
      </footer>
    </div>
  );
}
