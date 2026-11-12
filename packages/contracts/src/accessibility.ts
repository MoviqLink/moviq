import { z } from 'zod';

import { travelModeSchema } from './legs.js';
import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

/** A step-free elevator behind a platform's state, as the MTA names it. */
const accessElevatorSchema = z.object({
  /** The MTA equipment code, as `EL293`. */
  id: z.string().min(1),
  /** What it connects, as the outages feed writes it; null when only the lists say it is not working. */
  serving: z.string().nullable(),
  /** When the MTA says the outage began, or begins if announced; null without an outage. */
  since: instantSchema.nullable(),
  /** The MTA's estimate of its return, never a promise; null when it gives none. */
  estimatedReturn: instantSchema.nullable(),
  upcoming: z.boolean(),
});

/**
 * One platform where the traveller boards or leaves a ride. `accessible`: step-free both ways
 * according to the MTA station list; `one-direction`: only this platform's direction is;
 * `elevator-out`: an elevator of its step-free path is out during the trip; `not-step-free`: the
 * list says this platform has none; `unknown`: the lists cannot tell, and `cause` says why.
 */
const platformAccessSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  at: z.enum(['board', 'alight']),
  stopId: z.string().nullable(),
  station: z.string().min(1),
  state: z.enum(['accessible', 'one-direction', 'elevator-out', 'not-step-free', 'unknown']),
  /** Null for `accessible` and `one-direction`. */
  cause: z
    .enum([
      'outage',
      'not-in-service',
      'inactive',
      'note',
      'not-listed',
      'not-step-free',
      'lists-unavailable',
      'outage-unplaced',
    ])
    .nullable(),
  elevators: z.array(accessElevatorSchema),
});

/** What a step-free plan leaves out or does not verify. */
const accessWarningSchema = z.discriminatedUnion('kind', [
  /** Modes asked for whose timetables do not say which stops are step-free, as buses. */
  z.object({ kind: z.literal('modes-left-out'), modes: z.array(travelModeSchema).min(1) }),
  /** A change between two platforms: the MTA publishes no paths inside stations. */
  z.object({
    kind: z.literal('change-unverified'),
    legIndex: z.number().int().nonnegative(),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  /** The 2024 entrance survey lists no elevator or ramp: the walk is measured to the station. */
  z.object({
    kind: z.literal('entrance-not-surveyed'),
    legIndex: z.number().int().nonnegative(),
    station: z.string().min(1),
  }),
  /**
   * A walk on the streets not walked with the wheelchair profile (estimated): the itinerary
   * cannot be called step-free on that leg.
   */
  z.object({ kind: z.literal('walk-unverified'), legIndex: z.number().int().nonnegative() }),
]);

/** The step-free check of an itinerary: each platform, when the outages were read, the warnings. */
export const itineraryAccessibilitySchema = z.object({
  /** When the MTA elevator outages were read; null when they could not be. */
  checkedAt: instantSchema.nullable(),
  /** The outages feed as read, with its state and age. */
  provenance: provenanceSchema,
  platforms: z.array(platformAccessSchema),
  warnings: z.array(accessWarningSchema),
});
