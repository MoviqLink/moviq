import type { z } from 'zod';

export class RowShapeError extends Error {
  constructor(context: string, detail: string) {
    super(`Unexpected row shape in ${context}: ${detail}`);
    this.name = 'RowShapeError';
  }
}

/**
 * Validates a row coming back from SQL. Rows are input like any other: a schema change that
 * code did not expect fails loudly here instead of spreading wrong values.
 */
export function parseRow<T>(schema: z.ZodType<T>, row: unknown, context: string): T {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new RowShapeError(context, detail.join('; '));
  }
  return parsed.data;
}
