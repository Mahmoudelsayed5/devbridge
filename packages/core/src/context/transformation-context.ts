import type { EnumNode, ObjectNode } from "../ir/index.js";

/**
 * Holds every named type discovered during a transformation.
 *
 * Insertion order is preserved so that generators emit the root type first,
 * followed by nested types in the order they were discovered.
 *
 * Objects and enums are kept in separate maps, because almost every generator
 * wants to emit all the enums before the structures that refer to them, and
 * because the two are declared differently in every target. They do share one
 * *name* space, though — `enum Status` and `class Status` would collide in
 * any of the five languages — so a parser must allocate both from the same
 * allocator. {@link registerEnum} rejects a name an object already holds
 * rather than letting that collision reach a compiler.
 */
export class TransformationContext {
  private readonly types = new Map<string, ObjectNode>();
  private readonly enums = new Map<string, EnumNode>();

  /**
   * Registers a type. Re-registering the same name replaces the previous
   * declaration but keeps its original position, which lets a parser register
   * a placeholder and then complete it.
   */
  registerType(type: ObjectNode): void {
    if (this.enums.has(type.name)) {
      throw new Error(
        `Cannot register object type "${type.name}": an enum of that name already exists. Object and enum names share one namespace.`,
      );
    }

    this.types.set(type.name, type);
  }

  /**
   * Registers a named enum.
   *
   * @throws {Error} when an object type already holds the name, which every
   * target language would reject.
   */
  registerEnum(node: EnumNode): void {
    if (this.types.has(node.name)) {
      throw new Error(
        `Cannot register enum "${node.name}": an object type of that name already exists. Object and enum names share one namespace.`,
      );
    }

    this.enums.set(node.name, node);
  }

  getEnum(name: string): EnumNode | undefined {
    return this.enums.get(name);
  }

  hasEnum(name: string): boolean {
    return this.enums.has(name);
  }

  /** Every enum, in discovery order. */
  getEnums(): readonly EnumNode[] {
    return [...this.enums.values()];
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

  /** The number of object types. Enums are counted by `getEnums().length`. */
  get size(): number {
    return this.types.size;
  }
}
