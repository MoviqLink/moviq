import { z } from 'zod';
import { assistantTurnSchema, citySourceSchema } from './assistant.js';
import { instantSchema } from './time.js';

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  primary: z.boolean(),
});
export const agentCreateSchema = z.object({ name: z.string().trim().min(1).max(40) }).strict();
export const agentTurnRequestSchema = z
  .object({ message: z.string().trim().min(1).max(2000), lang: z.enum(['en', 'es']) })
  .strict();
export const agentMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: instantSchema,
  answer: assistantTurnSchema.nullable(),
});
export const watchCreateSchema = z
  .object({
    line: z.string().trim().min(1).max(120),
    kind: z.enum(['line', 'street']).default('line'),
    segmentId: z.string().min(1).max(100).optional(),
    thresholdKmh: z.number().min(1).max(130).optional(),
  })
  .strict();
export const watchUpdateSchema = z.object({ paused: z.boolean() }).strict();
export const agentWatchSchema = z.object({
  id: z.string(),
  line: z.string(),
  kind: z.enum(['line', 'street']),
  status: z.enum(['waiting', 'active', 'clear', 'unavailable', 'paused', 'needs_setup']),
  thresholdKmh: z.number().nullable(),
  speedKmh: z.number().nullable(),
  measuredAt: instantSchema.nullable(),
  checkedAt: instantSchema.nullable(),
  source: citySourceSchema.nullable(),
  alertedAt: instantSchema.nullable(),
});
export const agentListSchema = z.object({ agents: z.array(agentSchema).max(3) });
export const agentDetailSchema = z.object({
  agent: agentSchema,
  messages: z.array(agentMessageSchema),
  watches: z.array(agentWatchSchema),
});
export type Agent = z.infer<typeof agentSchema>;
export type AgentDetail = z.infer<typeof agentDetailSchema>;

export const roadSegmentsSchema = z.object({
  available: z.boolean(),
  source: citySourceSchema,
  segments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        borough: z.string().nullable(),
        measuredAt: instantSchema,
      }),
    )
    .max(50),
});
