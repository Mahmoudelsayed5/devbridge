/**
 * Walking the `extends` chain.
 *
 * Every generator needs some version of these: which types a base has, what
 * the full property set is once inheritance is taken into account, and —
 * for the targets that cannot inherit at all — the flattened view. Written
 * once here rather than five times.
 *
 * They take a lookup function rather than a `TransformationContext` so this
 * module stays inside `ir/`, which the context itself depends on.
 */

import type { ObjectNode, ObjectProperty } from "./types.js";

/** Resolves a type name to its node. Usually `context.getType`. */
export type TypeLookup = (name: string) => ObjectNode | undefined;

/**
 * The chain of types `node` extends, nearest base first.
 *
 * Stops on a cycle rather than looping. The parser refuses to build one, so
 * reaching that guard means a hand-built graph.
 */
export function ancestorsOf(
  node: ObjectNode,
  lookup: TypeLookup,
): ObjectNode[] {
  const chain: ObjectNode[] = [];
  const seen = new Set<string>([node.name]);

  let current = node;

  while (current.extends !== undefined) {
    const base = lookup(current.extends);

    if (base === undefined || seen.has(base.name)) {
      break;
    }

    seen.add(base.name);
    chain.push(base);
    current = base;
  }

  return chain;
}

/**
 * Every property of `node`, inherited ones first.
 *
 * This is the flattened view, for targets that cannot express inheritance in
 * the shape being generated — a Java `record`, say, which cannot extend a
 * class. A property redeclared by a subtype wins over the inherited one.
 */
export function allPropertiesOf(
  node: ObjectNode,
  lookup: TypeLookup,
): ObjectProperty[] {
  const merged = new Map<string, ObjectProperty>();
  const chain = ancestorsOf(node, lookup);

  // Walked furthest-ancestor first, so a nearer declaration overwrites it.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    for (const property of (chain[index] as ObjectNode).properties) {
      merged.set(property.name, property);
    }
  }

  for (const property of node.properties) {
    merged.set(property.name, property);
  }

  return [...merged.values()];
}

/** True when any type in `types` extends `node`. */
export function hasSubtypes(
  node: ObjectNode,
  types: Iterable<ObjectNode>,
): boolean {
  for (const candidate of types) {
    if (candidate.extends === node.name) {
      return true;
    }
  }

  return false;
}

/** The types that directly extend `node`, in declaration order. */
export function subtypesOf(
  node: ObjectNode,
  types: Iterable<ObjectNode>,
): ObjectNode[] {
  return [...types].filter((candidate) => candidate.extends === node.name);
}

/**
 * Orders types so a base always precedes the types that extend it.
 *
 * Python needs this outright — `class Cat(Pet)` fails if `Pet` is not yet
 * defined — and it reads better everywhere else. Declaration order is
 * otherwise preserved, so a document that already lists its bases first sees
 * no reordering at all.
 */
export function orderByInheritance(
  types: readonly ObjectNode[],
): ObjectNode[] {
  const byName = new Map(types.map((type) => [type.name, type]));
  const ordered: ObjectNode[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const place = (node: ObjectNode): void => {
    if (placed.has(node.name) || visiting.has(node.name)) {
      return;
    }

    visiting.add(node.name);

    const base = node.extends === undefined ? undefined : byName.get(node.extends);

    if (base !== undefined) {
      place(base);
    }

    visiting.delete(node.name);
    placed.add(node.name);
    ordered.push(node);
  };

  for (const type of types) {
    place(type);
  }

  return ordered;
}

/** True when `node` takes part in an inheritance relationship either way. */
export function inHierarchy(
  node: ObjectNode,
  types: Iterable<ObjectNode>,
): boolean {
  return node.extends !== undefined || hasSubtypes(node, types);
}
