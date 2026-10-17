import { TransformationError } from "../diagnostics/index.js";
import type { AnySourceParser, AnyTargetGenerator } from "./types.js";

export class Registry<
  T extends { readonly id: string; readonly label: string },
> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly what: string) {}

  register(entry: T): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  /** Like {@link get} but throws a listing error, which is what callers want. */
  require(id: string): T {
    const entry = this.entries.get(id);

    if (entry === undefined) {
      throw new TransformationError(
        `Unknown ${this.what} "${id}". Available: ${this.ids().join(", ")}`,
      );
    }

    return entry;
  }

  list(): readonly T[] {
    return [...this.entries.values()];
  }

  ids(): readonly string[] {
    return [...this.entries.keys()];
  }
}

export class ParserRegistry extends Registry<AnySourceParser> {
  constructor() {
    super("source format");
  }

  /** Finds a parser by file extension, with or without a leading dot. */
  findByExtension(extension: string): AnySourceParser | undefined {
    const normalized = extension.replace(/^\./, "").toLowerCase();

    return this.list().find((parser) =>
      parser.extensions.includes(normalized),
    );
  }
}

export class GeneratorRegistry extends Registry<AnyTargetGenerator> {
  constructor() {
    super("target format");
  }
}
