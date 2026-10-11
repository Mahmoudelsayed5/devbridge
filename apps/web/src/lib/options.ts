import type { GeneratorOptions } from "@devbridge/core";

/**
 * Every control the UI can show. A target opts in to the ones that mean
 * something for it, so the panel never offers a switch the generator ignores.
 */
export type OptionKey =
  | "packageName"
  | "style"
  | "indent"
  | "header"
  | "jsonAnnotations"
  | "accessors"
  | "useRequired"
  | "exportTypes"
  | "pointersForOptional"
  | "fieldStyle";

export interface OptionState {
  rootName: string;
  packageName: string;
  style: string;
  /** "default" | "2" | "4" | "tab" */
  indent: string;
  header: boolean;
  jsonAnnotations: boolean;
  accessors: boolean;
  useRequired: boolean;
  exportTypes: boolean;
  pointersForOptional: boolean;
  /** "preserve" | "snake_case" */
  fieldStyle: string;
}

export interface TargetDescriptor {
  readonly label: string;
  /** Controls this target understands, in display order. */
  readonly options: readonly OptionKey[];
  /** Choices for the `style` control, when the target has one. */
  readonly styles?: readonly { value: string; label: string }[];
  /** Placeholder for `packageName`, which each language names differently. */
  readonly packageLabel?: string;
  readonly packagePlaceholder?: string;
}

export const TARGETS: Readonly<Record<string, TargetDescriptor>> = {
  typescript: {
    label: "TypeScript",
    options: ["style", "exportTypes", "indent", "header"],
    styles: [
      { value: "interface", label: "interface" },
      { value: "type", label: "type alias" },
    ],
  },
  java: {
    label: "Java",
    options: ["packageName", "style", "accessors", "jsonAnnotations", "indent", "header"],
    styles: [
      { value: "class", label: "class" },
      { value: "record", label: "record" },
    ],
    packageLabel: "Package",
    packagePlaceholder: "com.example.model",
  },
  go: {
    label: "Go",
    options: ["packageName", "jsonAnnotations", "pointersForOptional", "header"],
    packageLabel: "Package",
    packagePlaceholder: "models",
  },
  python: {
    label: "Python",
    options: ["fieldStyle", "indent", "header"],
  },
  csharp: {
    label: "C#",
    options: ["packageName", "style", "jsonAnnotations", "useRequired", "indent", "header"],
    styles: [
      { value: "class", label: "class" },
      { value: "record", label: "record" },
    ],
    packageLabel: "Namespace",
    packagePlaceholder: "Example.Models",
  },
};

/** Defaults mirror each generator's own defaults, so the UI tells the truth. */
export const DEFAULT_OPTIONS: OptionState = {
  rootName: "Root",
  packageName: "",
  style: "",
  indent: "default",
  header: false,
  jsonAnnotations: true,
  accessors: true,
  useRequired: true,
  exportTypes: true,
  pointersForOptional: true,
  fieldStyle: "preserve",
};

/** Java's generator defaults to no Jackson annotations; everything else to on. */
export function defaultJsonAnnotations(target: string): boolean {
  return target !== "java";
}

function indentValue(indent: string): string | undefined {
  switch (indent) {
    case "2":
      return "  ";
    case "4":
      return "    ";
    case "tab":
      return "\t";
    default:
      return undefined;
  }
}

/**
 * Narrows the full UI state down to the options one target actually reads.
 *
 * Target-specific keys (`accessors`, `useRequired`, ...) are not part of the
 * shared `GeneratorOptions`; each generator declares its own interface
 * extending it and reads them back, so they are attached here and the result
 * is widened once.
 */
export function buildGeneratorOptions(
  target: string,
  state: OptionState,
): GeneratorOptions {
  const descriptor = TARGETS[target];
  const allowed = new Set<OptionKey>(descriptor?.options ?? []);
  const options: Record<string, unknown> = {};

  if (allowed.has("packageName") && state.packageName.trim().length > 0) {
    options["packageName"] = state.packageName.trim();
  }

  if (allowed.has("style") && state.style.length > 0) {
    options["style"] = state.style;
  }

  if (allowed.has("indent")) {
    const indent = indentValue(state.indent);

    if (indent !== undefined) {
      options["indent"] = indent;
    }
  }

  if (allowed.has("header") && state.header) {
    options["header"] = true;
  }

  if (allowed.has("jsonAnnotations")) {
    options["jsonAnnotations"] = state.jsonAnnotations;
  }

  if (allowed.has("accessors")) {
    options["accessors"] = state.accessors;
  }

  if (allowed.has("useRequired")) {
    options["useRequired"] = state.useRequired;
  }

  if (allowed.has("exportTypes")) {
    options["exportTypes"] = state.exportTypes;
  }

  if (allowed.has("pointersForOptional")) {
    options["pointersForOptional"] = state.pointersForOptional;
  }

  if (allowed.has("fieldStyle") && state.fieldStyle.length > 0) {
    options["fieldStyle"] = state.fieldStyle;
  }

  return options as GeneratorOptions;
}
