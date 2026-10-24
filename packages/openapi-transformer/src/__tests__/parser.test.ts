import { describe, expect, it } from "vitest";

import { parseOpenApi, validateOpenApi } from "../index.js";

const PETSTORE = `
openapi: 3.0.3
info:
  title: Petstore
  version: 1.2.0
  description: A tiny API.
servers:
  - url: https://api.example.com/v1
    description: Production
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer, format: int64 }
        name: { type: string }
        tag: { type: string }
        status: { type: string, enum: [available, sold] }
security:
  - bearerAuth: []
paths:
  /pets:
    parameters:
      - name: X-Request-Id
        in: header
        schema: { type: string, format: uuid }
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      parameters:
        - name: limit
          in: query
          required: false
          description: How many to return
          schema: { type: integer }
      responses:
        "200":
          description: A list of pets
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
    post:
      operationId: createPet
      summary: Create a pet
      tags: [pets]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses:
        "201": { description: Created }
  /pets/{petId}:
    get:
      operationId: getPet
      tags: [pets]
      deprecated: true
      parameters:
        - name: petId
          in: path
          required: true
          description: The pet id
          schema: { type: integer }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
        "404": { description: Not found }
`;

describe("parseOpenApi", () => {
  it("reads YAML and JSON equally", () => {
    const yaml = parseOpenApi(PETSTORE).model;

    const json = parseOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "T" },
        paths: { "/a": { get: { responses: {} } } },
      }),
    ).model;

    expect(yaml.title).toBe("Petstore");
    expect(json.title).toBe("T");
    expect(json.operations).toHaveLength(1);
  });

  it("collects info and servers", () => {
    const { model } = parseOpenApi(PETSTORE);

    expect(model.title).toBe("Petstore");
    expect(model.version).toBe("1.2.0");
    expect(model.servers[0]?.url).toBe("https://api.example.com/v1");
  });

  it("reads every operation with its verb and path", () => {
    const { model } = parseOpenApi(PETSTORE);

    expect(
      model.operations.map((o) => `${o.method} ${o.path}`),
    ).toEqual(["GET /pets", "POST /pets", "GET /pets/{petId}"]);
  });

  it("marks a deprecated operation", () => {
    const { model } = parseOpenApi(PETSTORE);

    expect(model.operations[2]?.deprecated).toBe(true);
    expect(model.operations[0]?.deprecated).toBe(false);
  });

  it("merges path-level parameters into each operation", () => {
    const { model } = parseOpenApi(PETSTORE);
    const get = model.operations[0];

    expect(get?.parameters.map((p) => p.name).sort()).toEqual([
      "X-Request-Id",
      "limit",
    ]);
  });

  it("treats a path parameter as required even when unstated", () => {
    const { model } = parseOpenApi(`
openapi: 3.0.0
info: { title: T }
paths:
  /a/{id}:
    get:
      parameters:
        - name: id
          in: path
          schema: { type: string }
      responses: {}
`);

    expect(model.operations[0]?.parameters[0]?.required).toBe(true);
  });

  it("describes parameter types and prefills examples", () => {
    const { model } = parseOpenApi(PETSTORE);
    const limit = model.operations[0]?.parameters.find(
      (p) => p.name === "limit",
    );

    expect(limit?.schemaType).toBe("integer");
    expect(limit?.description).toBe("How many to return");
    expect(limit?.example).toBe("0");

    const requestId = model.operations[0]?.parameters.find(
      (p) => p.name === "X-Request-Id",
    );

    expect(requestId?.location).toBe("header");
    expect(requestId?.example).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("synthesises a request body example through a $ref", () => {
    const { model } = parseOpenApi(PETSTORE);
    const body = model.operations[1]?.requestBody;

    expect(body?.mediaType).toBe("application/json");
    expect(body?.required).toBe(true);

    const parsed = JSON.parse(body?.example ?? "{}");

    expect(parsed).toEqual({
      id: 0,
      name: "string",
      tag: "string",
      // The first enum member is a better placeholder than "string".
      status: "available",
    });
  });

  it("synthesises an array response example", () => {
    const { model } = parseOpenApi(PETSTORE);
    const response = model.operations[0]?.responses[0];

    expect(response?.status).toBe("200");
    expect(JSON.parse(response?.example ?? "null")).toEqual([
      { id: 0, name: "string", tag: "string", status: "available" },
    ]);
  });

  it("reads security schemes and applies global security", () => {
    const { model } = parseOpenApi(PETSTORE);

    expect(model.securitySchemes).toEqual([
      { name: "bearerAuth", kind: "http", scheme: "bearer" },
    ]);

    expect(model.operations[0]?.security).toEqual(["bearerAuth"]);
  });

  it("does not loop on a self-referential schema", () => {
    const { model } = parseOpenApi(`
openapi: 3.0.0
info: { title: T }
components:
  schemas:
    Node:
      type: object
      properties:
        child: { $ref: '#/components/schemas/Node' }
paths:
  /n:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Node' }
      responses: {}
`);

    expect(model.operations[0]?.requestBody?.example).toBeDefined();
  });

  it("warns when no server is declared", () => {
    const { diagnostics } = parseOpenApi(`
openapi: 3.0.0
info: { title: T }
paths: { /a: { get: { responses: {} } } }
`);

    expect(diagnostics.map((d) => d.code)).toContain("openapi/no-servers");
  });
});

describe("validateOpenApi", () => {
  it("accepts a valid document", () => {
    expect(validateOpenApi(PETSTORE)).toEqual([]);
  });

  it("rejects empty input", () => {
    expect(validateOpenApi("  ")[0]?.code).toBe("openapi/empty-input");
  });

  it("rejects a document that is not OpenAPI", () => {
    expect(validateOpenApi('{"a":1}')[0]?.code).toBe("openapi/not-openapi");
  });

  it("names Swagger 2.0 specifically rather than rejecting it vaguely", () => {
    const diagnostics = validateOpenApi('{"swagger":"2.0","info":{}}');

    expect(diagnostics[0]?.code).toBe("openapi/swagger-2");
    expect(diagnostics[0]?.hint).toContain("swagger2openapi");
  });

  it("rejects a document with no paths", () => {
    expect(
      validateOpenApi("openapi: 3.0.0\ninfo: { title: T }\npaths: {}")[0]?.code,
    ).toBe("openapi/no-operations");
  });

  it("reports a syntax error", () => {
    const diagnostics = validateOpenApi("openapi: 3.0.0\n  bad: [indent");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("throws rather than returning a broken model", () => {
    expect(() => parseOpenApi('{"swagger":"2.0"}')).toThrow("Swagger 2.0");
    expect(() => parseOpenApi("")).toThrow("The input is empty.");
  });
});
