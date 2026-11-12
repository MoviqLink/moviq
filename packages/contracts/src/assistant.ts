import { z } from 'zod';

import { needRequestSchema } from './commerce.js';
import { flightSchema, placeSchema, planResponseSchema } from './journeys.js';
import { moneySchema } from './money.js';
import { sourceStateSchema } from './sources.js';
import { instantSchema } from './time.js';

/** `POST /api/assistant/turns`: one message from the traveller to Sara. */
export const assistantTurnRequestSchema = z.object({
  conversationId: z.string().min(1).nullable(),
  message: z.string().trim().min(1).max(2000),
  lang: z.enum(['en', 'es']),
  /** A question about this trip under watch, answered from its facts; the draft stays as it was. */
  journeyId: z.string().min(1).nullable().optional(),
  /**
   * With a trip, what Sara may tell the merchants on its way: the alias and the tastes the web
   * keeps. The server uses them only for the need message; they never reach the language model.
   */
  shopper: needRequestSchema.pick({ alias: true, taste: true }).strict().optional(),
});

export const planningSlotSchema = z.enum(['origin', 'destination', 'arriveBy']);

/** A source behind a city answer: its title, the time of its data and its state when read. */
export const citySourceSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  dataTime: instantSchema.nullable(),
  ageSeconds: z.number().nonnegative().nullable(),
  state: sourceStateSchema,
});

export type CitySource = z.infer<typeof citySourceSchema>;

/**
 * - `clear`: the sources answered and report nothing in force;
 * - `notice`: something is in force: an alert, an outage, a train held, a bus running late;
 * - `unknown`: a source could not be read, so nothing is claimed;
 * - `info`: facts without a verdict, such as where a vehicle is or a measure.
 */
export const cityLevelSchema = z.enum(['clear', 'notice', 'unknown', 'info']);

export type CityLevel = z.infer<typeof cityLevelSchema>;

/** What Sara found about a line, a station, a mode or a vehicle, from the data platform only. */
export const cityAnswerSchema = z.object({
  kind: z.enum([
    'line-status',
    'incidents',
    'where-is',
    'station-access',
    'line-reliability',
    'restrooms',
  ]),
  /** What was asked about, as Sara names it: `A`, `M15`, `59 St`, `PATH`. */
  subject: z.string().min(1),
  level: cityLevelSchema,
  /** One sentence in the traveller's language. */
  headline: z.string().min(1),
  /** Each detail as a sentence, with the time it refers to when it has one. */
  items: z.array(z.object({ text: z.string().min(1), at: instantSchema.nullable() })).max(8),
  sources: z.array(citySourceSchema).min(1),
});

export type CityAnswer = z.infer<typeof cityAnswerSchema>;

/** Sara's answer: what she understood, what she still needs, and the plan once she has it all. */
export const assistantTurnSchema = z.object({
  conversationId: z.string().min(1),
  /** `ai`: a language model answered; `basic`: the deterministic assistant, said so in the reply. */
  mode: z.enum(['ai', 'basic']),
  reply: z.string().min(1),
  draft: z.object({
    origin: placeSchema.nullable(),
    destination: placeSchema.nullable(),
    arriveBy: instantSchema.nullable(),
    flight: flightSchema.nullable(),
  }),
  missing: z.array(planningSlotSchema),
  plan: planResponseSchema.nullable(),
  /** Answers about the city this turn, each with its sources; empty when none was asked. */
  city: z.array(cityAnswerSchema).max(4),
  /**
   * Places Sara offers to choose from, in the order she numbers them, so the interface can show
   * them as buttons; absent when she is not waiting for a choice.
   */
  choices: z
    .object({
      slot: z.enum(['origin', 'destination']),
      options: z.array(z.string().min(1)).min(2).max(5),
    })
    .optional(),
  /** Tickets Sara bought this turn, each paid and recorded; absent when she bought none. */
  tickets: z
    .array(
      z.object({
        /** The ticket's id in the traveller's wallet of tickets. */
        id: z.uuid(),
        name: z.string().min(1),
        operator: z.string().min(1),
        price: moneySchema,
        /** `wallet`: from the trip wallet's balance; `paypal`: charged to the connected PayPal. */
        paidWith: z.enum(['wallet', 'paypal']),
        paypalOrderId: z.string().nullable(),
      }),
    )
    .max(8)
    .optional(),
  /**
   * An option of the trip Sara proposes. With a price, the server's: the PayPal button pays it,
   * and nothing is charged or applied before PayPal confirms. Only in answers about a trip.
   */
  proposal: z
    .object({ alternativeId: z.string().min(1), price: moneySchema.nullable() })
    .nullable()
    .optional(),
  /**
   * The need Sara passed to the demo merchants on the way this turn: the screen reads its
   * questions and validated offers from `GET /api/commerce/needs/:id`. Only in answers about a trip.
   */
  rewards: z
    .object({ needId: z.string().min(1) })
    .nullable()
    .optional(),
});

export type AssistantTurn = z.infer<typeof assistantTurnSchema>;
