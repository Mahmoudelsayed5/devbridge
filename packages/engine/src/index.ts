import type {
  AnySourceParser,
  AnyTargetGenerator,
  Diagnostic,
  GeneratedFile,
  GeneratorOptions,
  IrKind,
  ObjectNode,
  ParseOptions,
  RelationalModel,
  TransformationContext,
} from "@devbridge/core";
import {
  GeneratorRegistry,
  ParserRegistry,
  TransformationError,
} from "@devbridge/core";

import { cSharpGenerator } from "@devbridge/csharp-transformer";
import { dbmlGenerator } from "@devbridge/dbml-transformer";
import { goGenerator } from "@devbridge/go-transformer";
import { javaGenerator } from "@devbridge/java-transformer";
import { jsonParser } from "@devbridge/json-transformer";
import { mermaidGenerator } from "@devbridge/mermaid-transformer";
import { pythonGenerator } from "@devbridge/python-transformer";
import { sqlParser } from "@devbridge/sql-transformer";
import { typeScriptGenerator } from "@devbridge/typescript-transformer";

/**
 * The registries every DevBridge surface shares: the CLI, the web app and,
 * later, the editor extensions. Everything here runs locally.
 */
export const parsers = new ParserRegistry();
export const generators = new GeneratorRegistry();

parsers.register(jsonParser);
parsers.register(sqlParser);

generators.register(typeScriptGenerator);
generators.register(javaGenerator);
generators.register(goGenerator);
generators.register(pythonGenerator);
generators.register(cSharpGenerator);
generators.register(mermaidGenerator);
generators.register(dbmlGenerator);

export interface TransformRequest {
  /** Source artifact text. */
  readonly input: string;
  /** Source format id, for example `json`. */
  readonly source: string;
  /** Target format id, for example `java`. */
  readonly target: string;
  readonly parseOptions?: ParseOptions;
  readonly generatorOptions?: GeneratorOptions;
}

/** The IR a transformation produced, discriminated by family. */
export type TransformIr =
  | { readonly kind: "type-graph"; readonly root: ObjectNode; readonly context: TransformationContext }
  | { readonly kind: "relational"; readonly model: RelationalModel };

export interface TransformResult {
  readonly source: string;
  readonly target: string;
  readonly irKind: IrKind;
  readonly ir: TransformIr;
  readonly files: readonly GeneratedFile[];
  readonly preview: string;
  readonly diagnostics: readonly Diagnostic[];
  /** Type names for a type graph, table names for a relational model. */
  readonly names: readonly string[];
}

/** Human-readable name for each IR family, used in error messages. */
const FAMILY_LABEL: Readonly<Record<IrKind, string>> = {
  "type-graph": "data shapes",
  relational: "database schemas",
};

/**
 * Lists the targets that can consume what `source` produces.
 *
 * A JSON document and a SQL schema are not interchangeable inputs: one
 * describes the shape of a value, the other describes tables and the
 * relationships between them. Pairing them is a mistake worth naming rather
 * than a crash worth debugging.
 */
export function targetsFor(source: string): readonly FormatSummary[] {
  const parser = parsers.get(source);

  if (parser === undefined) {
    return [];
  }

  return generators
    .list()
    .filter((generator) => generator.irKind === parser.irKind)
    .map(({ id, label }) => ({ id, label }));
}

function assertCompatible(
  parser: AnySourceParser,
  generator: AnyTargetGenerator,
): void {
  if (parser.irKind === generator.irKind) {
    return;
  }

  const usable = targetsFor(parser.id)
    .map((target) => target.id)
    .join(", ");

  throw new TransformationError(
    `"${generator.id}" cannot read ${parser.label}: it renders ${FAMILY_LABEL[generator.irKind]}, and ${parser.label} produces ${FAMILY_LABEL[parser.irKind]}. Available targets for ${parser.id}: ${usable}.`,
  );
}

/**
 * Runs one transformation end to end.
 *
 * @throws {TransformationError} when the source or target is unknown, the two
 * are incompatible, or the artifact cannot be parsed.
 */
export function transform(request: TransformRequest): TransformResult {
  const parser = parsers.require(request.source);
  const generator = generators.require(request.target);

  assertCompatible(parser, generator);

  if (parser.irKind === "relational" && generator.irKind === "relational") {
    const parsed = parser.parse(request.input, request.parseOptions);
    const generated = generator.generate(parsed.model, request.generatorOptions);

    return {
      source: parser.id,
      target: generator.id,
      irKind: "relational",
      ir: { kind: "relational", model: parsed.model },
      files: generated.files,
      preview: generated.preview,
      diagnostics: [...parsed.diagnostics, ...(generated.diagnostics ?? [])],
      names: parsed.model.tables.map((table) => table.name),
    };
  }

  if (parser.irKind === "type-graph" && generator.irKind === "type-graph") {
    const parsed = parser.parse(request.input, request.parseOptions);

    const generated = generator.generate(
      parsed.root,
      parsed.context,
      request.generatorOptions,
    );

    return {
      source: parser.id,
      target: generator.id,
      irKind: "type-graph",
      ir: { kind: "type-graph", root: parsed.root, context: parsed.context },
      files: generated.files,
      preview: generated.preview,
      diagnostics: [...parsed.diagnostics, ...(generated.diagnostics ?? [])],
      names: parsed.context.getTypes().map((type) => type.name),
    };
  }

  // assertCompatible has already ruled this out; kept for exhaustiveness.
  throw new TransformationError(
    `Cannot pair "${parser.id}" with "${generator.id}".`,
  );
}

/** Validates an artifact without generating anything. */
export function validate(
  input: string,
  source: string,
): readonly Diagnostic[] {
  return parsers.require(source).validate(input);
}

export interface FormatSummary {
  readonly id: string;
  readonly label: string;
}

export interface SourceSummary extends FormatSummary {
  readonly irKind: IrKind;
  readonly extensions: readonly string[];
}

export interface TargetSummary extends FormatSummary {
  readonly irKind: IrKind;
  readonly extension: string;
}

export function listSources(): readonly SourceSummary[] {
  return parsers.list().map(({ id, label, irKind, extensions }) => ({
    id,
    label,
    irKind,
    extensions,
  }));
}

export function listTargets(): readonly TargetSummary[] {
  return generators.list().map(({ id, label, irKind, extension }) => ({
    id,
    label,
    irKind,
    extension,
  }));
}

/** Picks a source parser from a file name, for example `schema.sql`. */
export function sourceForFile(fileName: string): AnySourceParser | undefined {
  const dot = fileName.lastIndexOf(".");

  return dot === -1
    ? undefined
    : parsers.findByExtension(fileName.slice(dot + 1));
}

export type { AnySourceParser, AnyTargetGenerator };
