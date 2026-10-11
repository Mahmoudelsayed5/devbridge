import type { OptionKey, OptionState, TargetDescriptor } from "../lib/options.js";

interface OptionsPanelProps {
  readonly descriptor: TargetDescriptor | undefined;
  readonly state: OptionState;
  readonly onChange: (patch: Partial<OptionState>) => void;
}

const CHECKBOX_LABELS: Partial<Record<OptionKey, string>> = {
  header: "Generated-by header",
  jsonAnnotations: "Serialization annotations",
  accessors: "Getters and setters",
  useRequired: "required members (C# 11+)",
  exportTypes: "export declarations",
  pointersForOptional: "Pointers for optional fields",
};

export function OptionsPanel({
  descriptor,
  state,
  onChange,
}: OptionsPanelProps): React.JSX.Element | null {
  if (descriptor === undefined) {
    return null;
  }

  const has = (key: OptionKey): boolean => descriptor.options.includes(key);

  const checkboxes = descriptor.options.filter(
    (key): key is OptionKey => CHECKBOX_LABELS[key] !== undefined,
  );

  return (
    <details className="options">
      <summary>Options</summary>

      <div className="options-grid">
        <label>
          <span>Root type name</span>
          <input
            type="text"
            value={state.rootName}
            placeholder="Root"
            onChange={(event) => {
              onChange({ rootName: event.target.value });
            }}
          />
        </label>

        {has("packageName") ? (
          <label>
            <span>{descriptor.packageLabel ?? "Package"}</span>
            <input
              type="text"
              value={state.packageName}
              placeholder={descriptor.packagePlaceholder ?? ""}
              onChange={(event) => {
                onChange({ packageName: event.target.value });
              }}
            />
          </label>
        ) : null}

        {has("style") && descriptor.styles !== undefined ? (
          <label>
            <span>Shape</span>
            <select
              value={state.style === "" ? (descriptor.styles[0]?.value ?? "") : state.style}
              onChange={(event) => {
                onChange({ style: event.target.value });
              }}
            >
              {descriptor.styles.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has("fieldStyle") ? (
          <label>
            <span>Field names</span>
            <select
              value={state.fieldStyle}
              onChange={(event) => {
                onChange({ fieldStyle: event.target.value });
              }}
            >
              <option value="preserve">Keep JSON keys</option>
              <option value="snake_case">snake_case</option>
            </select>
          </label>
        ) : null}

        {has("indent") ? (
          <label>
            <span>Indent</span>
            <select
              value={state.indent}
              onChange={(event) => {
                onChange({ indent: event.target.value });
              }}
            >
              <option value="default">Language default</option>
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tab</option>
            </select>
          </label>
        ) : null}
      </div>

      {checkboxes.length > 0 ? (
        <div className="options-checks">
          {checkboxes.map((key) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={Boolean(state[key as keyof OptionState])}
                onChange={(event) => {
                  onChange({ [key]: event.target.checked } as Partial<OptionState>);
                }}
              />
              <span>{CHECKBOX_LABELS[key]}</span>
            </label>
          ))}
        </div>
      ) : null}

      <p className="options-note">
        Showing only what the {descriptor.label} generator reads. Switching
        target changes this list.
      </p>
    </details>
  );
}
