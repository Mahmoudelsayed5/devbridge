/**
 * Naming helpers shared by every generator.
 *
 * Source artifacts use whatever convention their author chose, so each target
 * language converts names once, here, instead of re-implementing the rules.
 */

/**
 * Splits an arbitrary identifier into lower-case words.
 *
 * Handles snake_case, kebab-case, spaces, camelCase and acronym runs:
 * `parseHTTPResponse` -> ["parse", "http", "response"].
 */
export function splitWords(value: string): string[] {
  const normalized = value.replace(/[^a-zA-Z0-9]+/g, " ");

  const spaced = normalized
    // camelCase / PascalCase boundary
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // end of an acronym run followed by a word: HTTPResponse -> HTTP Response
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // letter followed by digits
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2");

  return spaced
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function toPascalCase(value: string): string {
  return splitWords(value).map(capitalize).join("");
}

export function toCamelCase(value: string): string {
  const words = splitWords(value);

  if (words.length === 0) {
    return "";
  }

  return [words[0] as string, ...words.slice(1).map(capitalize)].join("");
}

export function toSnakeCase(value: string): string {
  return splitWords(value).join("_");
}

export function toKebabCase(value: string): string {
  return splitWords(value).join("-");
}

export interface IdentifierOptions {
  /** Reserved words of the target language. */
  readonly keywords?: ReadonlySet<string>;
  /** Appended when the name collides with a keyword. Defaults to `_`. */
  readonly keywordSuffix?: string;
  /** Prefixed when the name would start with a digit. Defaults to `_`. */
  readonly digitPrefix?: string;
  /** Used when the input contains no usable characters. Defaults to `value`. */
  readonly fallback?: string;
}

/**
 * Makes `value` safe to emit as an identifier: strips illegal characters,
 * avoids a leading digit and escapes reserved words.
 */
export function sanitizeIdentifier(
  value: string,
  options: IdentifierOptions = {},
): string {
  const {
    keywords,
    keywordSuffix = "_",
    digitPrefix = "_",
    fallback = "value",
  } = options;

  let identifier = value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+$/, "");

  if (identifier.length === 0) {
    identifier = fallback;
  }

  if (/^[0-9]/.test(identifier)) {
    identifier = `${digitPrefix}${identifier}`;
  }

  if (keywords?.has(identifier)) {
    identifier = `${identifier}${keywordSuffix}`;
  }

  return identifier;
}

/**
 * Hands out unique names. Used by generators that must keep field or class
 * names distinct after a case conversion merges two different source names
 * (for example `user_id` and `userId` both becoming `userId`).
 */
export class NameAllocator {
  private readonly used = new Set<string>();

  constructor(reserved: Iterable<string> = []) {
    for (const name of reserved) {
      this.used.add(name);
    }
  }

  has(name: string): boolean {
    return this.used.has(name);
  }

  reserve(name: string): void {
    this.used.add(name);
  }

  /** Returns `preferred`, or `preferred2`, `preferred3`, ... if it is taken. */
  allocate(preferred: string): string {
    if (!this.used.has(preferred)) {
      this.used.add(preferred);

      return preferred;
    }

    let suffix = 2;

    while (this.used.has(`${preferred}${suffix}`)) {
      suffix += 1;
    }

    const name = `${preferred}${suffix}`;

    this.used.add(name);

    return name;
  }
}
