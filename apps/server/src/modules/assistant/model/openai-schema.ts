import { z } from 'zod';

/**
 * The part of a Responses API answer (`POST /v1/responses`) that MovIQ reads, as documented in
 * https://developers.openai.com/api/reference/resources/responses/methods/create. Fields MovIQ
 * does not use are ignored; an output item of a kind MovIQ never asked for fails the schema, so
 * an unexpected answer is rejected instead of being half read.
 */

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const messageItemSchema = z.object({
  type: z.literal('message'),
  id: z.string().min(1),
  role: z.literal('assistant'),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('output_text'), text: z.string() }),
      z.object({ type: z.literal('refusal'), refusal: z.string() }),
    ]),
  ),
});

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  id: z.string().min(1).optional(),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
});

/** Reasoning is sent back as received within one exchange, as the function-calling guide asks. */
const reasoningItemSchema = z.object({
  type: z.literal('reasoning'),
  id: z.string().min(1),
  summary: z.array(z.object({ type: z.literal('summary_text'), text: z.string() })),
  encrypted_content: z.string().nullable().optional(),
});

export const responseSchema = z.object({
  id: z.string().min(1),
  object: z.literal('response'),
  status: z.enum(['completed', 'incomplete', 'failed', 'in_progress', 'cancelled', 'queued']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  incomplete_details: z.object({ reason: z.string() }).nullable(),
  output: z.array(
    z.discriminatedUnion('type', [messageItemSchema, functionCallItemSchema, reasoningItemSchema]),
  ),
  usage: usageSchema,
});

export type OpenAIResponse = z.infer<typeof responseSchema>;

export type OutputItem = OpenAIResponse['output'][number];

/** Only the usage, read on its own when the rest of an answer is rejected, to count its cost. */
export const usageOnlySchema = z.object({ usage: usageSchema });
