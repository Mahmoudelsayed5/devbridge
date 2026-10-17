/**
 * A small SQL tokenizer.
 *
 * It is deliberately dialect-tolerant rather than dialect-correct: the goal is
 * to read `CREATE TABLE` / `ALTER TABLE` out of a schema dump from MySQL,
 * PostgreSQL, SQL Server or SQLite, not to validate SQL. Anything it does not
 * understand becomes an ordinary token and is skipped by the parser.
 */

export type TokenKind = "word" | "string" | "number" | "symbol" | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** Identifier or keyword text with quoting removed; raw text otherwise. */
  readonly value: string;
  /** True when the token was written as a quoted identifier. */
  readonly quoted: boolean;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

const SYMBOLS = new Set([
  "(", ")", ",", ";", ".", "=", "<", ">", "+", "-", "*", "/", "%", "[", "]",
  "{", "}", ":", "?", "|", "&", "!", "~", "^", "@",
]);

/** Closing character for each quoted-identifier style. */
const IDENT_QUOTES: Readonly<Record<string, string>> = {
  '"': '"',
  "`": "`",
  "[": "]",
};

function isWordStart(char: string): boolean {
  return /[A-Za-z_#$]/.test(char);
}

function isWordPart(char: string): boolean {
  return /[A-Za-z0-9_$#]/.test(char);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let lineStart = 0;

  const push = (
    kind: TokenKind,
    value: string,
    offset: number,
    quoted = false,
  ): void => {
    tokens.push({
      kind,
      value,
      quoted,
      offset,
      line,
      column: offset - lineStart + 1,
    });
  };

  const advanceLines = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\n") {
        line += 1;
        lineStart = index + i + 1;
      }
    }
  };

  while (index < input.length) {
    const char = input[index] as string;

    if (char === "\n") {
      line += 1;
      index += 1;
      lineStart = index;

      continue;
    }

    if (/\s/.test(char)) {
      index += 1;

      continue;
    }

    // -- line comment, and MySQL's # line comment
    if ((char === "-" && input[index + 1] === "-") || char === "#") {
      const end = input.indexOf("\n", index);

      index = end === -1 ? input.length : end;

      continue;
    }

    // /* block comment */
    if (char === "/" && input[index + 1] === "*") {
      const end = input.indexOf("*/", index + 2);
      const stop = end === -1 ? input.length : end + 2;

      advanceLines(input.slice(index, stop));
      index = stop;

      continue;
    }

    // 'string literal', with '' and backslash escapes
    if (char === "'") {
      const start = index;
      let value = "";

      index += 1;

      while (index < input.length) {
        const current = input[index] as string;

        if (current === "\\" && index + 1 < input.length) {
          value += input[index + 1] as string;
          index += 2;

          continue;
        }

        if (current === "'") {
          if (input[index + 1] === "'") {
            value += "'";
            index += 2;

            continue;
          }

          index += 1;
          break;
        }

        value += current;
        index += 1;
      }

      advanceLines(input.slice(start, index));
      push("string", value, start);

      continue;
    }

    // "quoted identifier", `backticks`, [brackets]
    const closer = IDENT_QUOTES[char];

    if (closer !== undefined) {
      const start = index;
      let value = "";

      index += 1;

      while (index < input.length) {
        const current = input[index] as string;

        if (current === closer) {
          // A doubled closer is an escaped literal one.
          if (input[index + 1] === closer) {
            value += closer;
            index += 2;

            continue;
          }

          index += 1;
          break;
        }

        value += current;
        index += 1;
      }

      push("word", value, start, true);

      continue;
    }

    if (isWordStart(char)) {
      const start = index;

      while (index < input.length && isWordPart(input[index] as string)) {
        index += 1;
      }

      push("word", input.slice(start, index), start);

      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;

      while (index < input.length && /[0-9.eE+-]/.test(input[index] as string)) {
        // Only consume +/- when part of an exponent.
        const current = input[index] as string;

        if ((current === "+" || current === "-") && !/[eE]/.test(input[index - 1] as string)) {
          break;
        }

        index += 1;
      }

      push("number", input.slice(start, index), start);

      continue;
    }

    if (SYMBOLS.has(char)) {
      push("symbol", char, index);
      index += 1;

      continue;
    }

    // Unknown byte: consume it so the tokenizer always makes progress.
    index += 1;
  }

  push("eof", "", input.length);

  return tokens;
}
