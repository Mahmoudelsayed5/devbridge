export interface Transformation {
  readonly sourceFormat: string;
  readonly targetFormat: string;
}

export function createTransformation(
  sourceFormat: string,
  targetFormat: string,
): Transformation {
  return {
    sourceFormat,
    targetFormat,
  };
}
