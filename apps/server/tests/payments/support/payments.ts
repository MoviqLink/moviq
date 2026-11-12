import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { Transaction } from '@libsql/client';
import { toInstant, type Money, type PaymentPurpose } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../../src/infrastructure/clock/clock.js';
import type { Database } from '../../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../../src/infrastructure/database/migrations.js';
import { parseRow } from '../../../src/infrastructure/database/rows.js';
import type { PurchaseCatalog } from '../../../src/modules/payments/catalog.js';
import { tempDatabase, type TempDatabase } from '../../support/temp-database.js';

const MIGRATIONS = fileURLToPath(new URL('../../../migrations/', import.meta.url));

/**
 * A migrated database with `test_fulfilments`, where the test catalogue applies purchases: its
 * primary key makes a second application fail, and it commits only with the payment.
 */
export async function paymentsDatabase(
  clock: Clock,
): Promise<{ temp: TempDatabase; db: Database }> {
  const temp = await tempDatabase();
  const db = await temp.open();
  await migrate(db, await readMigrations(MIGRATIONS), clock);
  await db.execute('CREATE TABLE test_fulfilments (payment_id TEXT PRIMARY KEY, purpose TEXT)');
  return { temp, db };
}

export async function addTraveller(db: Database, clock: Clock): Promise<string> {
  const id = randomUUID();
  const now = toInstant(clock.now());
  await db.execute({
    sql: 'INSERT INTO travellers (id, created_at, last_seen_at) VALUES (?, ?, ?)',
    args: [id, now, now],
  });
  return id;
}

export const alternative = (alternativeId = 'taxi-1'): PaymentPurpose => ({
  kind: 'journey-alternative',
  journeyId: 'journey-1',
  alternativeId,
});

export interface TestCatalog extends PurchaseCatalog {
  /** The price of each alternative; one that is not listed is no longer offered. */
  readonly prices: Map<string, { amount: Money; description: string }>;
  quotes: number;
  /** When set, applying a purchase throws this. */
  fulfilError: Error | undefined;
}

export function testCatalog(): TestCatalog {
  const catalog: TestCatalog = {
    prices: new Map([
      ['taxi-1', { amount: { amountMinor: 2140, currency: 'USD' }, description: 'Taxi to JFK' }],
    ]),
    quotes: 0,
    fulfilError: undefined,
    quote: (purpose) => {
      catalog.quotes += 1;
      const price =
        purpose.kind === 'journey-alternative'
          ? catalog.prices.get(purpose.alternativeId)
          : undefined;
      return Promise.resolve(
        price === undefined
          ? { ok: false, reason: 'This option is no longer on offer.' }
          : { ok: true, ...price },
      );
    },
    fulfil: async (purpose, paymentId, tx: Transaction) => {
      if (catalog.fulfilError !== undefined) throw catalog.fulfilError;
      await tx.execute({
        sql: 'INSERT INTO test_fulfilments (payment_id, purpose) VALUES (?, ?)',
        args: [paymentId, JSON.stringify(purpose)],
      });
    },
  };
  return catalog;
}

const countSchema = z.object({ n: z.number() });

export async function count(
  db: Database,
  sql: string,
  args: (string | number)[] = [],
): Promise<number> {
  const result = await db.query({ sql, args });
  return parseRow(countSchema, result.rows[0], 'count').n;
}

export const fulfilments = (db: Database) =>
  count(db, 'SELECT COUNT(*) AS n FROM test_fulfilments');

const statusSchema = z.object({ status: z.string(), pending: z.string().nullable() });

export async function storedStatus(
  db: Database,
  id: string,
): Promise<{ status: string; pending: string | null }> {
  const result = await db.query({
    sql: 'SELECT status, pending FROM payment_operations WHERE id = ?',
    args: [id],
  });
  return parseRow(statusSchema, result.rows[0], 'payment_operations');
}
