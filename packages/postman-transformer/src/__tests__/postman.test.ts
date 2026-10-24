import { describe, expect, it } from "vitest";

import { parseOpenApi } from "@devbridge/openapi-transformer";

import type { PostmanOptions } from "../index.js";
import { generatePostman, postmanGenerator } from "../index.js";

const SPEC = `
openapi: 3.0.3
info:
  title: Petstore
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }
security:
  - bearerAuth: []
paths:
  /pets:
    get:
      summary: List pets
      tags: [pets]
      parameters:
        - { name: limit, in: query, schema: { type: integer } }
        - { name: status, in: query, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { type: array, items: { $ref: '#/components/schemas/Pet' } }
    post:
      summary: Create a pet
      tags: [pets]
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses:
        "201": { description: Created }
  /pets/{petId}:
    delete:
      summary: Remove a pet
      tags: [admin]
      parameters:
        - { name: petId, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Gone }
`;

function build(options: PostmanOptions = {}): Record<string, unknown> {
  const { model } = parseOpenApi(SPEC);

  return JSON.parse(generatePostman(model, options)) as Record<string, unknown>;
}

describe("generatePostman", () => {
  it("emits a valid v2.1 collection envelope", () => {
    const collection = build();
    const info = collection["info"] as Record<string, unknown>;

    expect(info["name"]).toBe("Petstore");
    expect(info["schema"]).toContain("v2.1.0");
    expect(Array.isArray(collection["item"])).toBe(true);
  });

  it("always produces parseable JSON", () => {
    const { model } = parseOpenApi(SPEC);

    expect(() => JSON.parse(generatePostman(model))).not.toThrow();
  });

  it("puts the server into a baseUrl variable", () => {
    const variables = build()["variable"] as { key: string; value: string }[];

    expect(variables[0]).toEqual({
      key: "baseUrl",
      value: "https://api.example.com/v1",
      type: "string",
    });
  });

  it("groups requests into folders by tag", () => {
    const items = build()["item"] as { name: string; item: unknown[] }[];

    expect(items.map((folder) => folder.name)).toEqual(["pets", "admin"]);
    expect(items[0]?.item).toHaveLength(2);
  });

  it("can emit a flat list instead", () => {
    const items = build({ folders: false })["item"] as { name: string }[];

    expect(items.map((item) => item.name)).toEqual([
      "List pets",
      "Create a pet",
      "Remove a pet",
    ]);
  });

  it("writes the URL against the baseUrl variable", () => {
    const items = build({ folders: false })["item"] as Record<string, any>[];
    const url = items[0]?.["request"].url;

    expect(url.host).toEqual(["{{baseUrl}}"]);
    expect(url.path).toEqual(["pets"]);
    expect(url.raw).toContain("{{baseUrl}}/pets");
  });

  it("converts a templated path segment to Postman's colon form", () => {
    const items = build({ folders: false })["item"] as Record<string, any>[];
    const url = items[2]?.["request"].url;

    expect(url.path).toEqual(["pets", ":petId"]);
    expect(url.variable).toEqual([{ key: "petId", value: "0" }]);
  });

  it("disables optional query parameters but keeps required ones on", () => {
    const items = build({ folders: false })["item"] as Record<string, any>[];
    const query = items[0]?.["request"].url.query as Record<string, unknown>[];

    const limit = query.find((entry) => entry["key"] === "limit");
    const status = query.find((entry) => entry["key"] === "status");

    expect(limit?.["disabled"]).toBe(true);
    expect(status?.["disabled"]).toBeUndefined();
  });

  it("prefills a request body and its content type", () => {
    const items = build({ folders: false })["item"] as Record<string, any>[];
    const request = items[1]?.["request"];

    expect(request.body.mode).toBe("raw");
    expect(request.body.options.raw.language).toBe("json");
    expect(JSON.parse(request.body.raw)).toEqual({ id: 0, name: "string" });

    expect(request.header).toContainEqual({
      key: "Content-Type",
      value: "application/json",
    });
  });

  it("saves response examples", () => {
    const items = build({ folders: false })["item"] as Record<string, any>[];
    const responses = items[0]?.["response"] as Record<string, unknown>[];

    expect(responses).toHaveLength(1);
    expect(responses[0]?.["code"]).toBe(200);
    expect(JSON.parse(String(responses[0]?.["body"]))).toEqual([
      { id: 0, name: "string" },
    ]);
  });

  it("can omit examples", () => {
    const items = build({ folders: false, examples: false })[
      "item"
    ] as Record<string, any>[];

    expect(items[0]?.["response"]).toEqual([]);
  });

  it("maps a bearer scheme onto collection auth", () => {
    expect(build()["auth"]).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{bearerToken}}", type: "string" }],
    });
  });

  it("maps an apiKey scheme onto collection auth", () => {
    const { model } = parseOpenApi(`
openapi: 3.0.0
info: { title: T }
components:
  securitySchemes:
    k: { type: apiKey, name: X-API-Key, in: header }
paths: { /a: { get: { responses: {} } } }
`);

    expect(generatePostman(model)).toContain('"type": "apikey"');
    expect(generatePostman(model)).toContain('"value": "X-API-Key"');
  });

  it("notes a deprecated operation in its description", () => {
    const { model } = parseOpenApi(`
openapi: 3.0.0
info: { title: T }
paths:
  /a:
    get:
      description: Old one.
      deprecated: true
      responses: {}
`);

    expect(generatePostman(model)).toContain("**Deprecated.**");
  });

  it("names the file safely from the API title", () => {
    const { model } = parseOpenApi(SPEC);
    const generated = postmanGenerator.generate(model);

    expect(postmanGenerator.id).toBe("postman");
    expect(postmanGenerator.irKind).toBe("api");
    expect(generated.files[0]?.path).toBe("Petstore.postman_collection.json");
  });

  it("strips path separators out of a hostile title", () => {
    const { model } = parseOpenApi(`
openapi: 3.0.0
info: { title: "../../etc/passwd" }
paths: { /a: { get: { responses: {} } } }
`);

    const path = postmanGenerator.generate(model).files[0]?.path ?? "";

    expect(path).not.toContain("/");
    expect(path).not.toContain("..");
  });
});
