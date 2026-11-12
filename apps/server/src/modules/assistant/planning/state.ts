import type { WatchNote } from './watch-tools.js';
import type { TicketNote } from './ticket-words.js';
import {
  flightSchema,
  instantSchema,
  placeSchema,
  planningSlotSchema,
  planResponseSchema,
  type AssistantTurn,
  type Flight,
  type Place,
  type PlanResponse,
} from '@moviq/contracts';
import { z } from 'zod';

type AirportCode = Flight['airport'];

import type { CityResult } from '../city/words.js';

type PlanningSlot = z.infer<typeof planningSlotSchema>;
export type PlaceSlot = 'origin' | 'destination';
export type Lang = 'en' | 'es';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** At most this many places are offered to choose from. */
export const MAX_CANDIDATES = 3;

/** What Sara keeps between turns: the draft of the trip, never the traveller's words. */
export const conversationStateSchema = z.object({
  draft: z.object({
    origin: placeSchema.nullable(),
    destination: placeSchema.nullable(),
    arriveBy: instantSchema.nullable(),
    flight: flightSchema.nullable(),
  }),
  /** The slot Sara asked about last, so a short answer ("125th Street", "7 pm") fills it. */
  asked: planningSlotSchema.nullable(),
  /** Places found for a slot when the search gave several, waiting for the traveller to pick. */
  candidates: z
    .object({
      slot: z.enum(['origin', 'destination']),
      query: z.string().min(1),
      places: z.array(placeSchema).min(2).max(MAX_CANDIDATES),
    })
    .nullable(),
  /**
   * A flight AeroDataBox could not give, waiting for the departure time on the boarding pass and
   * its airport; the terminal when the traveller knows it.
   */
  boardingPass: z
    .object({
      carrier: z.string().regex(/^[A-Z0-9]{2,3}$/),
      number: z.string().regex(/^\d{1,4}$/),
      date: dateSchema.nullable(),
      airport: flightSchema.shape.airport.nullable(),
      departureAt: instantSchema.nullable(),
      terminal: z.string().max(4).nullable(),
    })
    .nullable()
    .default(null),
  /** An airport code suggested for confirmation, never selected without consent. */
  pendingAirport: z
    .object({ airport: flightSchema.shape.airport, slot: z.enum(['origin', 'destination']) })
    .nullable()
    .default(null),
  /** An hour said without morning or evening ("at 7"), waiting for the traveller to say which. */
  pendingClock: z
    .object({
      day: dateSchema.nullable(),
      hour: z.number().int().min(1).max(12),
      minute: z.number().int().min(0).max(59),
    })
    .nullable(),
  /** A stop on the way the traveller asked for (a detour); the trip is planned through it. */
  stop: placeSchema.nullable().optional(),
  /** The plan of the complete draft; cleared whenever the draft changes. */
  plan: planResponseSchema.nullable(),
});

export type ConversationState = z.infer<typeof conversationStateSchema>;
type Draft = ConversationState['draft'];
export type PendingClock = NonNullable<ConversationState['pendingClock']>;
export type BoardingPassDraft = NonNullable<ConversationState['boardingPass']>;

export function emptyState(): ConversationState {
  return {
    draft: { origin: null, destination: null, arriveBy: null, flight: null },
    asked: null,
    candidates: null,
    boardingPass: null,
    pendingClock: null,
    pendingAirport: null,
    plan: null,
  };
}

/** What is still missing, in the order Sara asks for it. */
export function missingSlots(draft: Draft): AssistantTurn['missing'] {
  const missing: PlanningSlot[] = [];
  if (draft.destination === null) missing.push('destination');
  if (draft.arriveBy === null) missing.push('arriveBy');
  if (draft.origin === null) missing.push('origin');
  return missing;
}

/** A fact of this turn that the reply must tell, in order. */
export type Note =
  | { readonly kind: 'airport-which' }
  | { readonly kind: 'airport-confirm'; readonly airport: AirportCode }
  | { readonly kind: 'place-found'; readonly slot: PlaceSlot; readonly place: Place }
  | { readonly kind: 'place-not-found'; readonly slot: PlaceSlot; readonly query: string }
  | { readonly kind: 'places-unavailable'; readonly query: string }
  | { readonly kind: 'flight-found'; readonly flight: Flight }
  | { readonly kind: 'flight-not-found'; readonly flight: string; readonly date: string }
  | { readonly kind: 'flight-departed'; readonly flight: string }
  | {
      readonly kind: 'flights-unavailable';
      readonly flight: string;
      /** `allowance`: the month's AeroDataBox units are used up; `down`: it cannot answer. */
      readonly why: 'allowance' | 'down';
    }
  | { readonly kind: 'boarding-pass-used'; readonly flight: Flight }
  | { readonly kind: 'no-boarding-pass-flight' }
  | { readonly kind: 'airport-differs'; readonly said: string; readonly actual: string }
  | { readonly kind: 'airport-not-found'; readonly airport: string }
  | { readonly kind: 'time-passed'; readonly at: string }
  | { readonly kind: 'time-too-far' }
  | { readonly kind: 'flight-sets-time' }
  | { readonly kind: 'planned'; readonly plan: PlanResponse }
  | { readonly kind: 'plan-failed' };

/** One turn in progress: the state it changes and the facts it gathered. */
export interface Turn {
  readonly state: ConversationState;
  readonly notes: Note[];
  /** What the city tools found this turn, told in the reply and shown as cards. */
  readonly city: CityResult[];
  readonly lang: Lang;
  readonly now: Date;
  readonly travellerId: string;
  readonly signal: AbortSignal | undefined;
  /** A ticket purchase asked this turn; its reply is told with fixed words. */
  tickets?: TicketNote;
  /** A watch asked this turn; its reply is told with fixed words. */
  watch?: WatchNote;
}
