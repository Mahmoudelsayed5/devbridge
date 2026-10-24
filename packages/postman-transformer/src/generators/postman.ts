import type {
  ApiGenerator,
  ApiModel,
  ApiOperation,
  ApiSecurityScheme,
  GenerateResult,
  GeneratorOptions,
} from "@devbridge/core";
import { groupByTag, operationLabel, pathSegments } from "@devbridge/core";

export interface PostmanOptions extends GeneratorOptions {
  /** Collection name. Defaults to the API title. */
  readonly collectionName?: string;
  /** Group requests into folders by tag. Defaults to true. */
  readonly folders?: boolean;
  /** Include saved example responses. Defaults to true. */
  readonly examples?: boolean;
  /** Name of the emitted file. Defaults to `<name>.postman_collection.json`. */
  readonly fileName?: string;
}

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

/** The variable every request is written against, so one edit retargets all. */
const BASE_URL = "{{baseUrl}}";

interface KeyValue {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: KeyValue[];
  variable?: KeyValue[];
}

interface PostmanRequest {
  method: string;
  header: KeyValue[];
  url: PostmanUrl;
  description?: string;
  body?: {
    mode: "raw";
    raw: string;
    options: { raw: { language: string } };
  };
}

interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  response?: unknown[];
  item?: PostmanItem[];
  description?: string;
}

/**
 * Postman's auth block for a security scheme.
 *
 * Values are written as `{{variables}}` rather than blanks, so the collection
 * is configured in one place after import instead of per request.
 */
function authFor(scheme: ApiSecurityScheme): Record<string, unknown> | undefined {
  if (scheme.kind === "http" && scheme.scheme === "bearer") {
    return {
      type: "bearer",
      bearer: [{ key: "token", value: "{{bearerToken}}", type: "string" }],
    };
  }

  if (scheme.kind === "http" && scheme.scheme === "basic") {
    return {
      type: "basic",
      basic: [
        { key: "username", value: "{{username}}", type: "string" },
        { key: "password", value: "{{password}}", type: "string" },
      ],
    };
  }

  if (scheme.kind === "apiKey" && scheme.parameterName !== undefined) {
    return {
      type: "apikey",
      apikey: [
        { key: "key", value: scheme.parameterName, type: "string" },
        { key: "value", value: "{{apiKey}}", type: "string" },
        { key: "in", value: scheme.location ?? "header", type: "string" },
      ],
    };
  }

  if (scheme.kind === "oauth2" || scheme.kind === "openIdConnect") {
    return {
      type: "oauth2",
      oauth2: [{ key: "accessToken", value: "{{accessToken}}", type: "string" }],
    };
  }

  return undefined;
}

function languageFor(mediaType: string): string {
  if (mediaType.includes("json")) {
    return "json";
  }

  if (mediaType.includes("xml")) {
    return "xml";
  }

  return "text";
}

function buildUrl(operation: ApiOperation): PostmanUrl {
  const { segments, variables } = pathSegments(operation.path);

  const query = operation.parameters
    .filter((parameter) => parameter.location === "query")
    .map((parameter): KeyValue => ({
      key: parameter.name,
      value: parameter.example ?? "",
      ...(parameter.description === undefined
        ? {}
        : { description: parameter.description }),
      // Optional query parameters start switched off, so a request sends
      // only what it must and the rest are one click away.
      ...(parameter.required ? {} : { disabled: true }),
    }));

  const pathVariables = variables.map((name): KeyValue => {
    const parameter = operation.parameters.find(
      (candidate) => candidate.name === name && candidate.location === "path",
    );

    return {
      key: name,
      value: parameter?.example ?? "",
      ...(parameter?.description === undefined
        ? {}
        : { description: parameter.description }),
    };
  });

  const enabledQuery = query.filter((entry) => entry.disabled !== true);

  const rawQuery =
    enabledQuery.length === 0
      ? ""
      : `?${enabledQuery.map((entry) => `${entry.key}=${entry.value}`).join("&")}`;

  const raw = `${BASE_URL}/${segments.join("/")}${rawQuery}`;

  return {
    raw,
    host: [BASE_URL],
    path: segments,
    ...(query.length === 0 ? {} : { query }),
    ...(pathVariables.length === 0 ? {} : { variable: pathVariables }),
  };
}

function buildRequest(operation: ApiOperation): PostmanRequest {
  const header: KeyValue[] = operation.parameters
    .filter((parameter) => parameter.location === "header")
    .map((parameter) => ({
      key: parameter.name,
      value: parameter.example ?? "",
      ...(parameter.description === undefined
        ? {}
        : { description: parameter.description }),
      ...(parameter.required ? {} : { disabled: true }),
    }));

  if (operation.requestBody !== undefined) {
    header.unshift({
      key: "Content-Type",
      value: operation.requestBody.mediaType,
    });
  }

  if (operation.responses.some((response) => response.mediaType !== undefined)) {
    header.push({ key: "Accept", value: "application/json" });
  }

  const description = [
    operation.description,
    operation.deprecated ? "**Deprecated.**" : undefined,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");

  return {
    method: operation.method,
    header,
    url: buildUrl(operation),
    ...(description.length === 0 ? {} : { description }),
    ...(operation.requestBody?.example === undefined
      ? {}
      : {
          body: {
            mode: "raw" as const,
            raw: operation.requestBody.example,
            options: {
              raw: { language: languageFor(operation.requestBody.mediaType) },
            },
          },
        }),
  };
}

function buildExamples(operation: ApiOperation): unknown[] {
  return operation.responses
    .filter((response) => response.example !== undefined)
    .map((response) => ({
      name: `${response.status}${response.description === undefined ? "" : ` ${response.description}`}`,
      originalRequest: buildRequest(operation),
      status: response.description ?? "",
      code: Number.parseInt(response.status, 10) || 200,
      _postman_previewlanguage: "json",
      header: [
        {
          key: "Content-Type",
          value: response.mediaType ?? "application/json",
        },
      ],
      cookie: [],
      body: response.example,
    }));
}

function buildItem(
  operation: ApiOperation,
  options: PostmanOptions,
): PostmanItem {
  return {
    name: operationLabel(operation),
    request: buildRequest(operation),
    response: (options.examples ?? true) ? buildExamples(operation) : [],
  };
}

export function generatePostman(
  model: ApiModel,
  options: PostmanOptions = {},
): string {
  const name = options.collectionName ?? options.packageName ?? model.title;

  const items: PostmanItem[] =
    (options.folders ?? true)
      ? groupByTag(model).map((group) => ({
          name: group.tag,
          item: group.operations.map((operation) =>
            buildItem(operation, options),
          ),
        }))
      : model.operations.map((operation) => buildItem(operation, options));

  const auth = model.securitySchemes
    .map(authFor)
    .find((value): value is Record<string, unknown> => value !== undefined);

  const description = [
    model.description,
    model.version === undefined ? undefined : `Version ${model.version}`,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");

  const collection = {
    info: {
      name,
      schema: SCHEMA,
      ...(description.length === 0 ? {} : { description }),
    },
    item: items,
    ...(auth === undefined ? {} : { auth }),
    variable: [
      {
        key: "baseUrl",
        value: model.servers[0]?.url ?? "",
        type: "string",
      },
    ],
  };

  return `${JSON.stringify(collection, null, options.indent ?? 2)}\n`;
}

/**
 * Turns an API title into a safe file name.
 *
 * The title comes from the document, so it is untrusted input that ends up as
 * a path the CLI writes to. Separators are removed, and so is any leading run
 * of dots or dashes — `../../etc/passwd` must not survive as `..-..-etc`.
 */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.\-]+/, "")
    .replace(/[.\-]+$/, "");

  return cleaned.length === 0 ? "api" : cleaned;
}

export const postmanGenerator: ApiGenerator = {
  id: "postman",
  irKind: "api",
  label: "Postman collection",
  extension: "json",
  filePerType: false,
  generate(model: ApiModel, options: GeneratorOptions = {}): GenerateResult {
    const postmanOptions = options as PostmanOptions;
    const content = generatePostman(model, postmanOptions);

    const name = safeFileName(
      postmanOptions.collectionName ?? model.title ?? "api",
    );

    return {
      files: [
        {
          path: postmanOptions.fileName ?? `${name}.postman_collection.json`,
          content,
        },
      ],
      preview: content,
    };
  },
};
