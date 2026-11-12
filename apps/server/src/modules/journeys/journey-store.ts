import type { Transaction } from '@libsql/client';
import {
  alternativeSchema,
  incidentSchema,
  itinerarySchema,
  journeySchema,
  planRequestSchema,
  planResponseSchema,
  toInstant,
  type Journey,
  type PlanRequest,
  type PlanResponse,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/** Plans live for this long: enough to choose an itinerary, too short to go stale. */
const PLAN_TTL_MS = 30 * 60_000;

export interface StoredJourney {
  readonly journey: Journey;
  readonly travellerId: string;
  readonly version: number;
}

const json = <T extends z.ZodType>(schema: T) =>
  z.string().transform((text, context): z.infer<T> => {
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: parsed.error.message });
      return z.NEVER;
    }
    return parsed.data;
  });

const watchSchema = journeySchema.shape.watch;

const journeyRowSchema = z.object({
  id: z.string(),
  traveller_id: z.string(),
  state: z.enum(['watching', 'completed', 'cancelled']),
  request: json(planRequestSchema),
  itinerary: json(itinerarySchema),
  watch: json(watchSchema),
  incidents: json(z.array(incidentSchema)),
  alternatives: json(z.array(alternativeSchema)),
  created_at: z.string(),
  version: z.number().int().positive(),
});

const planRowSchema = z.object({
  request: json(planRequestSchema),
  response: json(planResponseSchema),
});

const toStored = (row: unknown): StoredJourney => {
  const parsed = parseRow(journeyRowSchema, row, 'journeys');
  return {
    travellerId: parsed.traveller_id,
    version: parsed.version,
    journey: {
      id: parsed.id,
      state: parsed.state,
      request: parsed.request,
      itinerary: parsed.itinerary,
      createdAt: parsed.created_at,
      watch: parsed.watch,
      incidents: parsed.incidents,
      alternatives: parsed.alternatives,
    },
  };
};

export type JourneyChanges = Partial<
  Pick<Journey, 'state' | 'request' | 'itinerary' | 'watch' | 'incidents' | 'alternatives'>
>;

export const journeyStore = {
  async savePlan(
    db: Database,
    travellerId: string,
    request: PlanRequest,
    response: PlanResponse,
    now: Date,
  ): Promise<void> {
    await db.execute({
      sql: 'INSERT INTO plans (id, traveller_id, request, response, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        response.planId,
        travellerId,
        JSON.stringify(request),
        JSON.stringify(response),
        toInstant(now),
        toInstant(new Date(now.getTime() + PLAN_TTL_MS)),
      ],
    });
  },

  /** A plan of this traveller that has not expired, or undefined. */
  async findPlan(
    db: Database,
    planId: string,
    travellerId: string,
    now: Date,
  ): Promise<{ request: PlanRequest; response: PlanResponse } | undefined> {
    const result = await db.query({
      sql: 'SELECT request, response FROM plans WHERE id = ? AND traveller_id = ? AND expires_at > ?',
      args: [planId, travellerId, toInstant(now)],
    });
    return result.rows.length === 0 ? undefined : parseRow(planRowSchema, result.rows[0], 'plans');
  },

  async create(db: Database, journey: Journey, travellerId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO journeys (id, traveller_id, state, request, itinerary, watch, incidents,
                alternatives, created_at, updated_at, version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          journey.id,
          travellerId,
          journey.state,
          JSON.stringify(journey.request),
          JSON.stringify(journey.itinerary),
          JSON.stringify(journey.watch),
          JSON.stringify(journey.incidents),
          JSON.stringify(journey.alternatives),
          journey.createdAt,
          toInstant(now),
        ],
      });
      await journeyStore.addEvent(
        tx,
        journey.id,
        'created',
        { itineraryId: journey.itinerary.id },
        now,
      );
    });
  },

  async get(db: Database, id: string): Promise<StoredJourney | undefined> {
    const result = await db.query({ sql: 'SELECT * FROM journeys WHERE id = ?', args: [id] });
    return result.rows.length === 0 ? undefined : toStored(result.rows[0]);
  },

  async getInTransaction(tx: Transaction, id: string): Promise<StoredJourney | undefined> {
    const result = await tx.execute({ sql: 'SELECT * FROM journeys WHERE id = ?', args: [id] });
    return result.rows.length === 0 ? undefined : toStored(result.rows[0]);
  },

  async version(db: Database, id: string): Promise<number | undefined> {
    const result = await db.query({ sql: 'SELECT version FROM journeys WHERE id = ?', args: [id] });
    return result.rows.length === 0
      ? undefined
      : parseRow(z.object({ version: z.number().int() }), result.rows[0], 'journeys').version;
  },

  async watching(db: Database): Promise<readonly StoredJourney[]> {
    const result = await db.query(
      "SELECT * FROM journeys WHERE state = 'watching' ORDER BY created_at",
    );
    return result.rows.map(toStored);
  },

  /** Applies changes only if nobody changed the journey since `expectedVersion`. */
  async update(
    tx: Transaction,
    id: string,
    expectedVersion: number,
    changes: JourneyChanges,
    now: Date,
  ): Promise<boolean> {
    const columns = Object.entries(changes).map(([key]) => `${key} = :${key}`);
    const values = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]),
    );
    const result = await tx.execute({
      sql: `UPDATE journeys SET ${[...columns, 'updated_at = :updated_at', 'version = version + 1'].join(', ')}
            WHERE id = :id AND version = :expected`,
      args: { ...values, updated_at: toInstant(now), id, expected: expectedVersion },
    });
    return result.rowsAffected === 1;
  },

  async addEvent(
    tx: Transaction,
    journeyId: string,
    kind: string,
    detail: unknown,
    now: Date,
  ): Promise<void> {
    await tx.execute({
      sql: 'INSERT INTO journey_events (journey_id, at, kind, detail) VALUES (?, ?, ?, ?)',
      args: [journeyId, toInstant(now), kind, JSON.stringify(detail)],
    });
  },
};
