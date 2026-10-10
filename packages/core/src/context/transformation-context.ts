import type { ObjectNode } from "../ir/index.js";

/**
 * Holds every named object type discovered during a transformation.
 *
 * Insertion order is preserved so that generators emit the root type first,
 * followed by nested types in the order they were discovered.
 */
export class TransformationContext {
  private readonly types = new Map<string, ObjectNode>();

  /**
   * Registers a type. Re-registering the same name replaces the previous
   * declaration but keeps its original position, which lets a parser register
   * a placeholder and then complete it.
   */
  registerType(type: ObjectNode): void {
    this.types.set(type.name, type);
  }

  getType(name: string): ObjectNode | undefined {
    return this.types.get(name);
  }

  hasType(name: string): boolean {
    return this.types.has(name);
  }

  getTypes(): readonly ObjectNode[] {
    return [...this.types.values()];
  }

  get size(): number {
    return this.types.size;
  }
}
