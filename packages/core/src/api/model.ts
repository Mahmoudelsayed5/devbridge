/**
 * The API intermediate representation.
 *
 * DevBridge's third IR, and the reason it exists is endpoints.
 *
 * An OpenAPI document holds two different kinds of information. Its
 * `components/schemas` are data shapes, which the type-graph IR in `../ir`
 * already models well. Its `paths` are not shapes at all: they are URLs,
 * verbs, parameters and sets of possible responses. There is no slot in
 * `TypeNode` for "GET", "path parameter" or "404", and a Postman collection
 * is a list of requests — precisely the part that would be lost.
 *
 * Everything else is shared with the other two IRs: naming, diagnostics,
 * `CodeWriter` and the registries.
 */

export type ParameterLocation = "path" | "query" | "header" | "cookie";

export interface ApiParameter {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  readonly description?: string;
  /** A concrete value to prefill, when the document supplies one. */
  readonly example?: string;
  /** Rendered schema type, e.g. `string`, `integer`, `string[]`. */
  readonly schemaType?: string;
}

export interface ApiBody {
  readonly mediaType: string;
  /** Example payload text, synthesised from the schema when absent. */
  readonly example?: string;
  readonly required: boolean;
}

export interface ApiResponse {
  /** `200`, `404`, or `default`. */
  readonly status: string;
  readonly description?: string;
  readonly mediaType?: string;
  readonly example?: string;
}

export type SecurityKind = "http" | "apiKey" | "oauth2" | "openIdConnect";

export interface ApiSecurityScheme {
  readonly name: string;
  readonly kind: SecurityKind;
  /** `bearer` or `basic` for http schemes. */
  readonly scheme?: string;
  /** Header, query or cookie name for apiKey schemes. */
  readonly parameterName?: string;
  readonly location?: ParameterLocation;
}

export interface ApiOperation {
  /** Upper-case HTTP verb. */
  readonly method: string;
  /** Templated path exactly as written, e.g. `/users/{id}`. */
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly deprecated: boolean;
  /** Tags, used to group requests into folders. */
  readonly tags: readonly string[];
  readonly parameters: readonly ApiParameter[];
  readonly requestBody?: ApiBody;
  readonly responses: readonly ApiResponse[];
  /** Names of the security schemes this operation requires. */
  readonly security: readonly string[];
}

export interface ApiServer {
  readonly url: string;
  readonly description?: string;
}

export interface ApiModel {
  readonly title: string;
  readonly version?: string;
  readonly description?: string;
  readonly servers: readonly ApiServer[];
  readonly operations: readonly ApiOperation[];
  readonly securitySchemes: readonly ApiSecurityScheme[];
}

/** Operations grouped by their first tag, in first-seen order. */
export function groupByTag(
  model: ApiModel,
): { tag: string; operations: readonly ApiOperation[] }[] {
  const groups = new Map<string, ApiOperation[]>();

  for (const operation of model.operations) {
    const tag = operation.tags[0] ?? "Default";
    const existing = groups.get(tag);

    if (existing === undefined) {
      groups.set(tag, [operation]);
    } else {
      existing.push(operation);
    }
  }

  return [...groups.entries()].map(([tag, operations]) => ({
    tag,
    operations,
  }));
}

/**
 * Splits a templated path into segments, converting OpenAPI's `{id}` into
 * Postman's `:id`. Returns the segments and the variable names found.
 */
export function pathSegments(path: string): {
  segments: string[];
  variables: string[];
} {
  const variables: string[] = [];

  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        variables.push(name);

        return `:${name}`;
      }),
    );

  return { segments, variables };
}

/** A human label for an operation, preferring summary then operationId. */
export function operationLabel(operation: ApiOperation): string {
  if (operation.summary !== undefined && operation.summary.length > 0) {
    return operation.summary;
  }

  if (operation.operationId !== undefined && operation.operationId.length > 0) {
    return operation.operationId;
  }

  return `${operation.method} ${operation.path}`;
}
