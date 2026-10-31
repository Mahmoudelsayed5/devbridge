import type { Diagnostic } from "@devbridge/core";
import { offsetToPosition } from "@devbridge/core";

/**
 * Finds object keys that appear more than once in the same object.
 *
 * `JSON.parse` keeps the last value and discards the rest without a word, so
 * `{"id": 1, "id": 2}` parses cleanly and quietly loses data — the same class
 * of silent loss this parser was rebuilt to stop. RFC 8259 permits duplicate
 * names but calls the behaviour undefined, which is exactly why a developer
 * should be told rather than guessing which value survived.
 *
 * Detecting it needs the raw text: by the time `JSON.parse` returns, the
 * evidence is gone. This is a small scanner rather than a full parser — it
 * only needs to know where strings are and which of them are keys, and it
 * runs on text already known to be valid JSON.
 */

export interface DuplicateKey {
  readonly key: string;
  /** Offset of the second (and later) occurrence. */
  readonly offset: number;
}

/** One frame of the nesting stack. */
interface Frame {
  readonly kind: "object" | "array";
  /** Keys already seen in this object, and where they first appeared. */
  readonly seen: Set<string>;
}

/**
 * Reads a JSON string literal starting at `start` (the opening quote).
 * Returns the decoded value and the offset just past the closing quote.
 */
function readString(
  text: string,
  start: number,
): { value: string; end: number } {
  let value = "";
  let index = start + 1;

  while (index < text.length) {
    const char = text[index] as string;

    if (char === "\\") {
      const escape = text[index + 1] as string | undefined;

      if (escape === undefined) {
        break;
      }

      // Only \u needs decoding to compare keys correctly; the rest map
      // one-to-one closely enough that a mismatch cannot create a false
      // duplicate.
      if (escape === "u") {
        const code = text.slice(index + 2, index + 6);

        value += String.fromCharCode(Number.parseInt(code, 16) || 0);
        index += 6;

        continue;
      }

      const simple: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        b: "\b",
        f: "\f",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };

      value += simple[escape] ?? escape;
      index += 2;

      continue;
    }

    if (char === '"') {
      return { value, end: index + 1 };
    }

    value += char;
    index += 1;
  }

  return { value, end: index };
}

export function findDuplicateKeys(text: string): readonly DuplicateKey[] {
  const duplicates: DuplicateKey[] = [];
  const stack: Frame[] = [];

  // Inside an object, a string is a key only when a value is not expected.
  let expectingValue = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index] as string;

    if (char === '"') {
      const { value, end } = readString(text, index);
      const frame = stack[stack.length - 1];

      if (frame?.kind === "object" && !expectingValue) {
        if (frame.seen.has(value)) {
          duplicates.push({ key: value, offset: index });
        } else {
          frame.seen.add(value);
        }
      }

      index = end;

      continue;
    }

    switch (char) {
      case "{":
        stack.push({ kind: "object", seen: new Set() });
        expectingValue = false;
        break;

      case "[":
        stack.push({ kind: "array", seen: new Set() });
        expectingValue = true;
        break;

      case "}":
      case "]":
        stack.pop();
        // Whatever contained this is now a completed value.
        expectingValue = false;
        break;

      case ":":
        expectingValue = true;
        break;

      case ",":
        // In an object the next string is a key again; in an array it is not.
        expectingValue = stack[stack.length - 1]?.kind === "array";
        break;

      default:
        break;
    }

    index += 1;
  }

  return duplicates;
}

/**
 * Reports duplicate keys as warnings.
 *
 * One diagnostic per duplicated key, located at the surviving occurrence,
 * because that is the value the generated types will describe.
 */
export function duplicateKeyDiagnostics(text: string): readonly Diagnostic[] {
  return findDuplicateKeys(text).map((duplicate): Diagnostic => {
    const { line, column } = offsetToPosition(text, duplicate.offset);

    return {
      severity: "warning",
      code: "json/duplicate-key",
      message: `The key "${duplicate.key}" appears more than once in the same object; JSON.parse keeps only the last value.`,
      offset: duplicate.offset,
      line,
      column,
      hint: "The generated type describes the surviving value. Remove the duplicate to be sure which one that is.",
    };
  });
}
