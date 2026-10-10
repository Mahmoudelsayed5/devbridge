import type { ObjectNode, ObjectProperty, TypeNode } from "@devbridge/core";
import {
  NameAllocator,
  TransformationContext,
  primitive,
  sanitizeIdentifier,
  toPascalCase,
} from "@devbridge/core";

import type { ObjectShape, Shape } from "./shape.js";
import { orderedProperties } from "./shape.js";

/**
 * One place in the document where an object type is needed, together with the
 * name fragments leading to it. `users[].profile` has the path
 * `["Root", "UsersItem", "Profile"]`.
 */
interface ObjectSite {
  readonly shape: ObjectShape;
  readonly path: readonly string[];
}

function collectSites(
  shape: Shape,
  parentPath: readonly string[],
  fragment: string,
  sites: ObjectSite[],
): void {
  switch (shape.kind) {
    case "primitive":
      return;

    case "array":
      if (shape.element !== undefined) {
        collectSites(shape.element, parentPath, `${fragment}Item`, sites);
      }

      return;

    case "union":
      for (const member of shape.members) {
        collectSites(member, parentPath, fragment, sites);
      }

      return;

    case "object": {
      const path = [...parentPath, fragment];

      sites.push({ shape, path });

      for (const { name, property } of orderedProperties(shape)) {
        collectSites(property.shape, path, toPascalCase(name), sites);
      }

      return;
    }
  }
}

function candidateName(site: ObjectSite, level: number): string {
  const fragments = site.path.slice(Math.max(0, site.path.length - level));

  return sanitizeIdentifier(fragments.join(""), { fallback: "Type" });
}

/**
 * Assigns a unique type name to every object site.
 *
 * The rule, which matches the blueprint's "contextual naming" requirement:
 * use the shortest name that is unique. A bare property name wins when nothing
 * else wants it, and a conflict pulls in as many parent fragments as needed.
 * Two structurally identical objects in different places stay separate types.
 */
function assignNames(
  sites: readonly ObjectSite[],
  rootName: string,
): Map<ObjectShape, string> {
  const names = new Map<ObjectShape, string>();
  const allocator = new NameAllocator();

  const rootSite = sites[0];

  if (rootSite === undefined) {
    return names;
  }

  names.set(
    rootSite.shape,
    allocator.allocate(
      sanitizeIdentifier(toPascalCase(rootName) || "Root", { fallback: "Root" }),
    ),
  );

  const levels = new Map<ObjectShape, number>();
  let pending = sites.slice(1);

  for (const site of pending) {
    levels.set(site.shape, 1);
  }

  while (pending.length > 0) {
    const counts = new Map<string, number>();

    for (const site of pending) {
      const name = candidateName(site, levels.get(site.shape) ?? 1);

      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const stillPending: ObjectSite[] = [];

    for (const site of pending) {
      const level = levels.get(site.shape) ?? 1;
      const name = candidateName(site, level);

      if (counts.get(name) === 1 && !allocator.has(name)) {
        allocator.reserve(name);
        names.set(site.shape, name);

        continue;
      }

      if (level < site.path.length) {
        levels.set(site.shape, level + 1);
        stillPending.push(site);

        continue;
      }

      // Fully qualified and still ambiguous: fall back to a numeric suffix.
      names.set(site.shape, allocator.allocate(name));
    }

    pending = stillPending;
  }

  return names;
}

function toTypeNode(
  shape: Shape,
  nodes: Map<ObjectShape, ObjectNode>,
): TypeNode {
  switch (shape.kind) {
    case "primitive":
      return primitive(shape.type);

    case "object": {
      const node = nodes.get(shape);

      if (node === undefined) {
        throw new Error("Internal error: object shape was never named");
      }

      return node;
    }

    case "array":
      return {
        kind: "array",
        elementType:
          shape.element === undefined
            ? primitive("unknown")
            : toTypeNode(shape.element, nodes),
      };

    case "union":
      return {
        kind: "union",
        types: shape.members.map((member) => toTypeNode(member, nodes)),
      };
  }
}

function buildObjectNode(
  shape: ObjectShape,
  name: string,
  nodes: Map<ObjectShape, ObjectNode>,
): void {
  const properties: ObjectProperty[] = [];

  // Reserve the node before its children so that generators always see a
  // declaration, even though JSON itself can never be cyclic.
  const node: ObjectNode = { kind: "object", name, properties };

  nodes.set(shape, node);

  for (const { name: propertyName, property } of orderedProperties(shape)) {
    properties.push({
      name: propertyName,
      value: toTypeNode(property.shape, nodes),
      optional: property.present < shape.samples,
    });
  }
}

/**
 * Turns a merged shape into the IR: a named root object plus a context holding
 * every discovered type, in document order.
 */
export function buildIr(
  shape: ObjectShape,
  rootName: string,
): { root: ObjectNode; context: TransformationContext } {
  const sites: ObjectSite[] = [];

  collectSites(shape, [], toPascalCase(rootName) || "Root", sites);

  const names = assignNames(sites, rootName);
  const nodes = new Map<ObjectShape, ObjectNode>();

  // Deepest sites first, so a parent's properties always find built children.
  const ordered = [...sites].sort(
    (left, right) => right.path.length - left.path.length,
  );

  for (const site of ordered) {
    buildObjectNode(site.shape, names.get(site.shape) as string, nodes);
  }

  const context = new TransformationContext();

  // Register in document order: root first, then nested types as discovered.
  for (const site of sites) {
    context.registerType(nodes.get(site.shape) as ObjectNode);
  }

  const root = nodes.get(shape);

  if (root === undefined) {
    throw new Error("Internal error: root object was never built");
  }

  return { root, context };
}
