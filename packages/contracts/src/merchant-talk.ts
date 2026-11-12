import { z } from 'zod';

import { agentRulesSchema } from './commerce.js';
import { weeklyHoursSchema } from './merchant.js';

/**
 * "Your agent", F-J9-14: the merchant talks with its agent. The agent answers from its real rules
 * and recent checks; a change it proposes has passed the server's own check and is saved only
 * when the merchant confirms it with `PUT /agent`, from the version it was proposed on.
 */

/** `POST /agent/talk`: what the merchant wrote, in the panel's language. */
export const agentTalkRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(400),
  language: z.enum(['en', 'es']),
});

/** A change the agent proposes: the whole rules and hours to save, and the version they are on. */
const proposalSchema = z.object({
  rules: agentRulesSchema,
  hours: weeklyHoursSchema,
  version: z.number().int(),
});

export type AgentProposal = z.infer<typeof proposalSchema>;

/**
 * The agent's answer. `off`: this server has no AI model, so the form is the way; `unavailable`:
 * the model gave no usable answer now. `answer`: its words, and the change it proposes, or why
 * the server refused the change it wanted.
 */
export const agentTalkSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('off') }),
  z.object({ mode: z.literal('unavailable') }),
  z.object({
    mode: z.literal('answer'),
    reply: z.string().min(1),
    proposal: proposalSchema.nullable(),
    /** The server's sentence when the change the agent wanted breaks a rule; never saved. */
    refused: z.string().nullable(),
  }),
]);

export type AgentTalk = z.infer<typeof agentTalkSchema>;
