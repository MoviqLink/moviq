import { z } from 'zod';

/** A TEXT column holding JSON, read through the schema of what it must contain. */
export function jsonColumn<T>(schema: z.ZodType<T>) {
  return z.string().transform((text, context): T => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: 'the stored JSON does not match its schema' });
    return z.NEVER;
  });
}
