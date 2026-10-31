export { parseJson, validateJson, jsonParser } from "./parser.js";
export type { JsonParseOptions } from "./parser.js";

export { inferShape, mergeShapes, orderedProperties } from "./shape.js";
export type {
  ArrayShape,
  ObjectShape,
  PrimitiveShape,
  PropertyShape,
  Shape,
  UnionShape,
} from "./shape.js";

export { buildIr } from "./builder.js";
export { findDuplicateKeys, duplicateKeyDiagnostics } from "./duplicates.js";
export type { DuplicateKey } from "./duplicates.js";
