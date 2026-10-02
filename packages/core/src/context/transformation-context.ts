import type { ObjectNode } from "../ir";

export class TransformationContext {
  private readonly types = new Map<string, ObjectNode>();

  registerType(type: ObjectNode): void {
    this.types.set(type.name, type);
  }

  getType(name: string): ObjectNode | undefined {
    return this.types.get(name);
  }

  getTypes(): readonly ObjectNode[] {
    return [...this.types.values()];
  }
}
