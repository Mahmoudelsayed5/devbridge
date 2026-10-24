import type {
  ApiBody,
  ApiModel,
  ApiOperation,
  ApiParameter,
  ApiParseResult,
  ApiResponse,
  ApiSecurityScheme,
  ApiServer,
  ApiSourceParser,
  Diagnostic,
  ParameterLocation,
  ParseOptions,
  SecurityKind,
} from "@devbridge/core";
import { TransformationError } from "@devbridge/core";
import { parse as parseYaml } from "yaml";

import { deref, describeType, exampleFor, scalarExample } from "./schema.js";

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

const EMPTY_INPUT: Diagnostic = {
  severity: "error",
  code: "openapi/empty-input",
  message: "The input is empty.",
  line: 1,
  column: 1,
  hint: "Paste or load an OpenAPI document first.",
};

const NOT_OPENAPI: Diagnostic = {
  severity: "error",
  code: "openapi/not-openapi",
  message: "This does not look like an OpenAPI document.",
  line: 1,
  column: 1,
  hint: 'An OpenAPI 3 document has a top-level "openapi" field, for example openapi: 3.0.3.',
};

const SWAGGER_2: Diagnostic = {
  severity: "error",
  code: "openapi/swagger-2",
  message: "Swagger 2.0 documents are not supported; this reads OpenAPI 3.",
  line: 1,
  column: 1,
  hint: "Convert the document to OpenAPI 3 first, for example with swagger2openapi.",
};

const NO_OPERATIONS: Diagnostic = {
  severity: "error",
  code: "openapi/no-operations",
  message: "The document declares no paths, so there is nothing to request.",
  line: 1,
  column: 1,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads the document as JSON or YAML.
 *
 * OpenAPI documents are written in both, roughly evenly, so supporting only
 * one would make the feature half useful. YAML is a superset of JSON, so one
 * parser covers both — but JSON is tried first because its errors are better.
 */
function readDocument(input: string): {
  document: unknown;
  diagnostic?: Diagnostic;
} {
  const text = input.replace(/^﻿/, "");

  try {
    return { document: JSON.parse(text) };
  } catch {
    // Not JSON; fall through to YAML.
  }

  try {
    return { document: parseYaml(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The yaml package reports a line/col in its message; surface it as-is.
    const position = /at line (\d+), column (\d+)/.exec(message);

    return {
      document: undefined,
      diagnostic: {
        severity: "error",
        code: "openapi/invalid-syntax",
        message: message.split("\n")[0] ?? message,
        ...(position?.[1] === undefined
          ? {}
          : { line: Number(position[1]), column: Number(position[2]) }),
        hint: "The document must be valid JSON or YAML.",
      },
    };
  }
}

function parseParameters(
  document: unknown,
  raw: unknown,
  diagnostics: Diagnostic[],
): ApiParameter[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const parameters: ApiParameter[] = [];

  for (const entry of raw) {
    const parameter = deref(document, entry);

    if (parameter === undefined) {
      continue;
    }

    const name = text(parameter["name"]);
    const location = text(parameter["in"]);

    if (name === undefined || location === undefined) {
      continue;
    }

    if (!["path", "query", "header", "cookie"].includes(location)) {
      diagnostics.push({
        severity: "warning",
        code: "openapi/unknown-parameter-location",
        message: `Parameter "${name}" has an unrecognised location "${location}" and was skipped.`,
      });

      continue;
    }

    const example =
      text(parameter["example"]) ??
      scalarExample(document, parameter["schema"]);

    const schemaType = describeType(document, parameter["schema"]);

    parameters.push({
      name,
      location: location as ParameterLocation,
      // A path parameter is required by definition.
      required: parameter["required"] === true || location === "path",
      ...(text(parameter["description"]) === undefined
        ? {}
        : { description: text(parameter["description"]) as string }),
      ...(example === undefined ? {} : { example }),
      ...(schemaType === undefined ? {} : { schemaType }),
    });
  }

  return parameters;
}

/** Picks the media type to prefill, preferring JSON. */
function pickMediaType(content: Record<string, unknown>): string | undefined {
  const types = Object.keys(content);

  return (
    types.find((type) => type.includes("json")) ??
    types.find((type) => type.includes("form")) ??
    types[0]
  );
}

function parseBody(document: unknown, raw: unknown): ApiBody | undefined {
  const body = deref(document, raw);
  const content = record(body?.["content"]);

  if (body === undefined || content === undefined) {
    return undefined;
  }

  const mediaType = pickMediaType(content);

  if (mediaType === undefined) {
    return undefined;
  }

  const media = record(content[mediaType]);

  const example =
    media?.["example"] !== undefined
      ? JSON.stringify(media["example"], null, 2)
      : JSON.stringify(exampleFor(document, media?.["schema"]), null, 2);

  return {
    mediaType,
    required: body["required"] === true,
    ...(example === undefined ? {} : { example }),
  };
}

function parseResponses(document: unknown, raw: unknown): ApiResponse[] {
  const responses = record(raw);

  if (responses === undefined) {
    return [];
  }

  return Object.entries(responses).flatMap(([status, value]): ApiResponse[] => {
    const response = deref(document, value);

    if (response === undefined) {
      return [];
    }

    const content = record(response["content"]);
    const mediaType = content === undefined ? undefined : pickMediaType(content);
    const media =
      mediaType === undefined ? undefined : record(content?.[mediaType]);

    const example =
      media === undefined
        ? undefined
        : JSON.stringify(
            media["example"] ?? exampleFor(document, media["schema"]),
            null,
            2,
          );

    return [
      {
        status,
        ...(text(response["description"]) === undefined
          ? {}
          : { description: text(response["description"]) as string }),
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(example === undefined ? {} : { example }),
      },
    ];
  });
}

function parseSecuritySchemes(document: unknown): ApiSecurityScheme[] {
  const components = record(record(document)?.["components"]);
  const schemes = record(components?.["securitySchemes"]);

  if (schemes === undefined) {
    return [];
  }

  return Object.entries(schemes).flatMap(([name, value]): ApiSecurityScheme[] => {
    const scheme = deref(document, value);
    const kind = text(scheme?.["type"]);

    if (
      scheme === undefined ||
      kind === undefined ||
      !["http", "apiKey", "oauth2", "openIdConnect"].includes(kind)
    ) {
      return [];
    }

    const location = text(scheme["in"]);

    return [
      {
        name,
        kind: kind as SecurityKind,
        ...(text(scheme["scheme"]) === undefined
          ? {}
          : { scheme: (text(scheme["scheme"]) as string).toLowerCase() }),
        ...(text(scheme["name"]) === undefined
          ? {}
          : { parameterName: text(scheme["name"]) as string }),
        ...(location === undefined
          ? {}
          : { location: location as ParameterLocation }),
      },
    ];
  });
}

function securityNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => Object.keys(record(entry) ?? {}));
}

/** Reports every problem that would stop `parseOpenApi` from producing IR. */
export function validateOpenApi(input: string): readonly Diagnostic[] {
  if (input.trim().length === 0) {
    return [EMPTY_INPUT];
  }

  const { document, diagnostic } = readDocument(input);

  if (diagnostic !== undefined) {
    return [diagnostic];
  }

  const root = record(document);

  if (root === undefined) {
    return [NOT_OPENAPI];
  }

  if (text(root["swagger"]) !== undefined) {
    return [SWAGGER_2];
  }

  if (text(root["openapi"]) === undefined) {
    return [NOT_OPENAPI];
  }

  const paths = record(root["paths"]);

  if (paths === undefined || Object.keys(paths).length === 0) {
    return [NO_OPERATIONS];
  }

  return [];
}

/**
 * Parses an OpenAPI 3 document into the API IR.
 *
 * @throws {TransformationError} when the document cannot be represented.
 */
export function parseOpenApi(
  input: string,
  _options: ParseOptions = {},
): ApiParseResult {
  const problems = validateOpenApi(input);
  const blocking = problems.find((problem) => problem.severity === "error");

  if (blocking !== undefined) {
    throw new TransformationError(blocking.message, [blocking]);
  }

  const { document } = readDocument(input);
  const root = record(document) as Record<string, unknown>;
  const diagnostics: Diagnostic[] = [];

  const info = record(root["info"]);
  const paths = record(root["paths"]) as Record<string, unknown>;
  const globalSecurity = securityNames(root["security"]);

  const servers: ApiServer[] = Array.isArray(root["servers"])
    ? root["servers"].flatMap((entry): ApiServer[] => {
        const server = record(entry);
        const url = text(server?.["url"]);

        return url === undefined
          ? []
          : [
              {
                url,
                ...(text(server?.["description"]) === undefined
                  ? {}
                  : { description: text(server?.["description"]) as string }),
              },
            ];
      })
    : [];

  const operations: ApiOperation[] = [];

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(document, rawItem);

    if (item === undefined) {
      continue;
    }

    // Parameters declared on the path apply to every operation under it.
    const shared = parseParameters(document, item["parameters"], diagnostics);

    for (const method of METHODS) {
      const operation = record(item[method]);

      if (operation === undefined) {
        continue;
      }

      const own = parseParameters(document, operation["parameters"], diagnostics);

      // An operation-level parameter overrides a path-level one of the same
      // name and location, which is what the specification requires.
      const merged = [
        ...shared.filter(
          (parameter) =>
            !own.some(
              (candidate) =>
                candidate.name === parameter.name &&
                candidate.location === parameter.location,
            ),
        ),
        ...own,
      ];

      const body = parseBody(document, operation["requestBody"]);
      const security =
        operation["security"] === undefined
          ? globalSecurity
          : securityNames(operation["security"]);

      operations.push({
        method: method.toUpperCase(),
        path,
        deprecated: operation["deprecated"] === true,
        tags: Array.isArray(operation["tags"])
          ? operation["tags"].filter(
              (tag): tag is string => typeof tag === "string",
            )
          : [],
        parameters: merged,
        responses: parseResponses(document, operation["responses"]),
        security,
        ...(text(operation["operationId"]) === undefined
          ? {}
          : { operationId: text(operation["operationId"]) as string }),
        ...(text(operation["summary"]) === undefined
          ? {}
          : { summary: text(operation["summary"]) as string }),
        ...(text(operation["description"]) === undefined
          ? {}
          : { description: text(operation["description"]) as string }),
        ...(body === undefined ? {} : { requestBody: body }),
      });
    }
  }

  if (operations.length === 0) {
    throw new TransformationError(NO_OPERATIONS.message, [NO_OPERATIONS]);
  }

  if (servers.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "openapi/no-servers",
      message: "The document declares no servers, so requests use a {{baseUrl}} variable with no value.",
      hint: "Set baseUrl in the collection after importing it.",
    });
  }

  const model: ApiModel = {
    title: text(info?.["title"]) ?? "API",
    servers,
    operations,
    securitySchemes: parseSecuritySchemes(document),
    ...(text(info?.["version"]) === undefined
      ? {}
      : { version: text(info?.["version"]) as string }),
    ...(text(info?.["description"]) === undefined
      ? {}
      : { description: text(info?.["description"]) as string }),
  };

  return { model, diagnostics };
}

export const openApiParser: ApiSourceParser = {
  id: "openapi",
  irKind: "api",
  label: "OpenAPI",
  extensions: ["yaml", "yml", "openapi"],
  parse: (input, options) => parseOpenApi(input, options ?? {}),
  validate: validateOpenApi,
};
