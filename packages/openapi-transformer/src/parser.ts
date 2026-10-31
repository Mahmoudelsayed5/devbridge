import type {
  AlsoProducesTypeGraph,
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

import {
  NO_OPERATIONS,
  pathsOf,
  readDocument,
  record,
  text,
  validateDocument,
} from "./document.js";
import { deref, describeType, exampleFor, scalarExample } from "./schema.js";
import { parseOpenApiSchemas } from "./schemas.js";

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

/**
 * Reports problems with the document as a document.
 *
 * This is the parser's `validate`, which the editors and the web app call as
 * you type — before any target has been chosen. It therefore checks only what
 * every reading needs, and in particular does *not* require `paths`: a file
 * of nothing but reusable schemas is valid input for the language targets.
 * Whether the half you need is actually present is settled by the parse,
 * which is the first point at which the target is known.
 */
export function validateOpenApi(input: string): readonly Diagnostic[] {
  return validateDocument(input);
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

  // Checked here rather than in `validate` because it is specific to this
  // reading: a schemas-only document is perfectly good input for the language
  // targets, and only fails when you ask it for a collection of requests.
  if (pathsOf(document) === undefined) {
    throw new TransformationError(NO_OPERATIONS.message, [NO_OPERATIONS]);
  }

  const diagnostics: Diagnostic[] = [];

  const info = record(root["info"]);
  const paths = pathsOf(document) as Record<string, unknown>;
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

/**
 * The OpenAPI parser, which is the one source that offers two IRs.
 *
 * Its `paths` are HTTP endpoints and become a Postman collection; its
 * `components/schemas` are data shapes and become models in any of the five
 * languages. The engine picks the reading from the target you chose — see
 * {@link AlsoProducesTypeGraph}.
 */
export const openApiParser: ApiSourceParser & AlsoProducesTypeGraph = {
  id: "openapi",
  irKind: "api",
  label: "OpenAPI",
  extensions: ["yaml", "yml", "openapi"],
  parse: (input, options) => parseOpenApi(input, options ?? {}),
  validate: validateOpenApi,
  alsoProduces: "type-graph",
  parseTypeGraph: (input, options) => parseOpenApiSchemas(input, options ?? {}),
};
