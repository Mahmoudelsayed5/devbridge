import { describe, expect, it } from "vitest";
import { parseJson } from "../index";

describe("parseJson", () => {
  it("parses a nested JSON object into named types", () => {
    const input = JSON.stringify({
      user: {
        id: 10,
        name: "Mahmoud",
      },
    });

    const result = parseJson(input);

    expect(result.root.name).toBe("Root");

    const userProperty = result.root.properties.find(
      (property) => property.name === "user",
    );

    expect(userProperty).toBeDefined();
    expect(userProperty?.value.kind).toBe("object");

    expect(result.context.getType("Root")).toBeDefined();
    expect(result.context.getType("User")).toBeDefined();

    const user = result.context.getType("User");

    expect(user?.properties).toHaveLength(2);
    expect(user?.properties[0].name).toBe("id");
    expect(user?.properties[0].value).toEqual({
      kind: "primitive",
      type: "integer",
    });

    expect(user?.properties[1].name).toBe("name");
    expect(user?.properties[1].value).toEqual({
      kind: "primitive",
      type: "string",
    });
  });

  it("rejects non-object JSON roots", () => {
    expect(() => parseJson('"hello"')).toThrow("JSON root must be an object");
  });

  it("creates unique names for nested objects with the same property name", () => {
    const input = JSON.stringify({
      company: {
        address: {
          city: "Cairo",
        },
      },
      customer: {
        address: {
          city: "Alexandria",
        },
      },
    });

    const { context } = parseJson(input);

    const types = context.getTypes();

    const names = types.map((type) => type.name);

    expect(names).toContain("Company");
    expect(names).toContain("Customer");
    expect(names).toContain("CompanyAddress");
    expect(names).toContain("CustomerAddress");

    expect(names).not.toContain("Address");
  });

  it("distinguishes integer and decimal values", () => {
    const input = JSON.stringify({
      age: 25,
      price: 19.99,
    });

    const { root } = parseJson(input);

    const age = root.properties.find((property) => property.name === "age");

    const price = root.properties.find((property) => property.name === "price");

    expect(age?.value).toEqual({
      kind: "primitive",
      type: "integer",
    });

    expect(price?.value).toEqual({
      kind: "primitive",
      type: "number",
    });
  });
});
