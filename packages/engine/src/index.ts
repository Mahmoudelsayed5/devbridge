import type {
  Diagnostic,
  GeneratedFile,
  GeneratorOptions,
  ObjectNode,
  ParseOptions,
  SourceParser,
  TargetGenerator,
  TransformationContext,
} from "@devbridge/core";
import { GeneratorRegistry, ParserRegistry } from "@devbridge/core";

import { cSharpGenerator } from "@devbridge/csharp-transformer";
import { goGenerator } from "@devbridge/go-transformer";
import { javaGenerator } from "@devbridge/java-transformer";
import { jsonParser } from "@devbridge/json-transformer";
import { pythonGenerator } from "@devbridge/python-transformer";
import { typeScriptGenerator } from "@devbridge/typescript-transformer";

/**
 * The registries every DevBridge surface shares: the CLI, the web app and,
 * later, the editor extensions. Everything here runs locally.
 */
export const parsers = new ParserRegistry();
export const generators = new GeneratorRegistry();

parsers.register(jsonParser);

generators.register(typeScriptGenerator);
generators.register(javaGenerator);
generators.register(goGenerator);
generators.register(pythonGenerator);
generators.register(cSharpGenerator);

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

export interface TransformResult {
  readonly source: string;
  readonly target: string;
  readonly root: ObjectNode;
  readonly context: TransformationContext;
  readonly files: readonly GeneratedFile[];
  readonly preview: string;
  readonly diagnostics: readonly Diagnostic[];
  /** Names of every type the transformation discovered, root first. */
  readonly types: readonly string[];
}

/**
 * Runs one transformation end to end.
 *
 * @throws {TransformationError} when the source or target is unknown, or when
 * the artifact cannot be parsed.
 */
export function transform(request: TransformRequest): TransformResult {
  const parser = parsers.require(request.source);
  const generator = generators.require(request.target);

  const parsed = parser.parse(request.input, request.parseOptions);

  const generated = generator.generate(
    parsed.root,
    parsed.context,
    request.generatorOptions,
  );

  return {
    source: parser.id,
    target: generator.id,
    root: parsed.root,
    context: parsed.context,
    files: generated.files,
    preview: generated.preview,
    diagnostics: [...parsed.diagnostics, ...(generated.diagnostics ?? [])],
    types: parsed.context.getTypes().map((type) => type.name),
  };
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

export function listSources(): readonly FormatSummary[] {
  return parsers.list().map(({ id, label }) => ({ id, label }));
}

export function listTargets(): readonly FormatSummary[] {
  return generators.list().map(({ id, label }) => ({ id, label }));
}

/** Picks a source parser from a file name, for example `schema.json`. */
export function sourceForFile(fileName: string): SourceParser | undefined {
  const dot = fileName.lastIndexOf(".");

  return dot === -1
    ? undefined
    : parsers.findByExtension(fileName.slice(dot + 1));
}

export type { SourceParser, TargetGenerator };
