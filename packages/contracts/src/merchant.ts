import { z } from 'zod';

import {
  agentRulesSchema,
  allergenSchema,
  kitchenTicketSchema,
  merchantCustomerSchema,
  merchantRequestSchema,
  merchantSummarySchema,
  needMessageSchema,
  offerRefusalSchema,
  payoutViewSchema,
  rewardOfferSchema,
  rewardSchema,
} from './commerce.js';
import { apiErrorSchema } from './errors.js';
import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

/**
 * The answers of `/api/merchant`, the demo merchant's panel: the server builds each one with
 * these types and the web validates each one before a screen shows it. Amounts are integer
 * cents set by the server.
 */

/** `GET /merchants`: the demo merchants to enter as. */
export const merchantListSchema = z.object({ merchants: z.array(merchantSummarySchema) });

/** `GET|POST|DELETE /session`: the merchant comes only with an open session. */
export const merchantSessionSchema = z.discriminatedUnion('signedIn', [
  z.object({ signedIn: z.literal(true), merchant: merchantSummarySchema }),
  z.object({ signedIn: z.literal(false) }),
]);

export const requestListSchema = z.object({ requests: z.array(merchantRequestSchema) });
export const ticketListSchema = z.object({ tickets: z.array(kitchenTicketSchema) });
export const customerListSchema = z.object({ customers: z.array(merchantCustomerSchema) });

/** `POST /tickets/:orderId/status`: where the kitchen moved the ticket. */
export const statusChangeSchema = z.object({
  orderId: z.string(),
  status: kitchenTicketSchema.shape.status,
});

/** `GET /payouts`: where payouts go, whether they can be sent, what is owed and the batches. */
export const payoutBoardSchema = z.object({
  receiver: z.string(),
  /** Whether PayPal Payouts is set up on this server. */
  available: z.boolean(),
  /** Refunds the merchant bears that a payout has not deducted yet: taken from the next one. */
  refundsToDeduct: moneySchema,
  batches: z.array(payoutViewSchema),
});

/** A dish as "Your agent" shows it: what the kitchen may leave out and add. */
const menuItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceMinor: z.number().int(),
  ingredients: z.array(
    z.object({ name: z.string(), allergens: z.array(allergenSchema), removable: z.boolean() }),
  ),
  extras: z.array(
    z.object({
      name: z.string(),
      priceMinor: z.number().int(),
      allergens: z.array(allergenSchema),
    }),
  ),
});

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'a New York time, HH:MM' });

/** One opening stretch of a day, New York wall clock; `24:00` closes at midnight. */
const openingSlotSchema = z.strictObject({
  opens: clockTime,
  closes: z.union([clockTime, z.literal('24:00')]),
});

const daySlotsSchema = z.array(openingSlotSchema).max(3);

/** When the agent may promise a pickup: up to three stretches a day, none for a day closed. */
export const weeklyHoursSchema = z.strictObject({
  mon: daySlotsSchema,
  tue: daySlotsSchema,
  wed: daySlotsSchema,
  thu: daySlotsSchema,
  fri: daySlotsSchema,
  sat: daySlotsSchema,
  sun: daySlotsSchema,
});

export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

export type HoursProblem =
  | { readonly problem: 'ends-before-start' | 'overlap'; readonly day: Weekday }
  | { readonly problem: 'closed-all-week'; readonly day: null };

/**
 * What is wrong with some opening hours, or null: a stretch that closes before it opens, two
 * stretches of a day that overlap or are out of order, or a week with no opening at all. The
 * server refuses hours with a problem; the web says it before asking.
 */
export function hoursProblem(hours: WeeklyHours): HoursProblem | null {
  for (const day of WEEKDAYS) {
    const slots = hours[day];
    if (slots.some((slot) => slot.closes <= slot.opens)) {
      return { problem: 'ends-before-start', day };
    }
    if (slots.some((slot, index) => index > 0 && slot.opens < (slots[index - 1]?.closes ?? ''))) {
      return { problem: 'overlap', day };
    }
  }
  return WEEKDAYS.every((day) => hours[day].length === 0)
    ? { problem: 'closed-all-week', day: null }
    : null;
}

/** `GET /agent`: rules, version, the program's minimum, hours, menu and whether it talks. */
export const agentSetupSchema = z.object({
  rules: agentRulesSchema,
  version: z.number().int(),
  minRewardPercent: z.number().int(),
  hours: weeklyHoursSchema,
  menu: z.array(menuItemSchema),
  /** Whether the agent can talk with its merchant: only with an AI model on the server. */
  talk: z.boolean(),
});

/** `PUT /agent`: the rules from the version read; the hours stay as they were when left out. */
export const agentUpdateSchema = z.strictObject({
  rules: agentRulesSchema,
  version: z.number().int().positive(),
  hours: weeklyHoursSchema.optional(),
});

/** What `PUT /agent` saved, with the version to send next. */
export const savedRulesSchema = z.object({
  rules: agentRulesSchema,
  version: z.number().int(),
  hours: weeklyHoursSchema,
});

const scanIdentity = {
  orderId: z.string(),
  code: z.string(),
  status: statusChangeSchema.shape.status,
};

/** `POST /scan`: charged (200), or PayPal still confirming the charge (202). */
export const scanAnswerSchema = z.union([
  z.object({ ...scanIdentity, charged: moneySchema }),
  z.object({ ...scanIdentity, message: z.string() }),
]);

/** Why a scan charged nothing; the error body keeps its sentence and adds this code. */
export const scanRefusalReasonSchema = z.enum([
  'not-moviq',
  'expired',
  'used',
  'no-order',
  'other-merchant',
  'cancelled',
  'payments-off',
  'unconfirmed',
  'paypal-unavailable',
  'not-charged',
]);

export type ScanRefusalReason = z.infer<typeof scanRefusalReasonSchema>;

/** A refused scan (403, 404 or 409): the usual error body with the reason's code. */
export const scanRefusalSchema = z.object({
  error: apiErrorSchema.shape.error.extend({ reason: scanRefusalReasonSchema }),
});

export type ScanRefusal = z.infer<typeof scanRefusalSchema>;

/** `POST /orders/:id/refunds`: 200 when PayPal confirmed it all, 202 while some is `pending`. */
export const refundAnswerSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  refunded: moneySchema,
  pending: moneySchema,
});

/** The example customers the preview composes for. */
export const previewExampleSchema = z.enum(['no-preferences', 'vegetarian', 'allergies']);

const previewLines = rewardOfferSchema.shape.lines;

/** What the agent's rules make of one example customer, and the server's check of it. */
const previewOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nothing') }),
  z.object({
    kind: z.literal('accepted'),
    lines: previewLines,
    note: z.string(),
    pickupAt: instantSchema,
    reward: rewardSchema,
  }),
  z.object({
    kind: z.literal('rejected'),
    lines: previewLines,
    note: z.string(),
    pickupAt: instantSchema,
    refusals: z.array(z.object({ reason: offerRefusalSchema, message: z.string() })),
  }),
]);

/** `GET /agent/preview`: offers the rules would compose now, saved nowhere, without the model. */
export const agentPreviewSchema = z.object({
  composer: z.literal('rules'),
  composedAt: instantSchema,
  cases: z.array(
    z.object({
      example: previewExampleSchema,
      alias: z.string(),
      craving: z.string(),
      preferences: needMessageSchema.shape.preferences,
      outcome: previewOutcomeSchema,
    }),
  ),
});

export type AgentPreview = z.infer<typeof agentPreviewSchema>;
