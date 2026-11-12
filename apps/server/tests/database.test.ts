import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DatabaseBusyError, type Database } from '../src/infrastructure/database/database.js';
import { parseRow, RowShapeError } from '../src/infrastructure/database/rows.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

let temp: TempDatabase;
let db: Database;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT');
});

afterEach(async () => {
  await temp.dispose();
});

async function count(target: Database): Promise<number> {
  const result = await target.query('SELECT COUNT(*) AS n FROM items');
  return Number(result.rows[0]?.['n']);
}

describe('Database', () => {
  it('runs many concurrent writes from one process without lock errors', async () => {
    const writes = Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0
        ? db.execute({
            sql: 'INSERT INTO items (label) VALUES (?)',
            args: [`row ${String(index)}`],
          })
        : db.transaction(async (tx) => {
            await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['a'] });
            await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['b'] });
          }),
    );
    await Promise.all(writes);
    expect(await count(db)).toBe(75);
  });

  it('waits for another process holding the write lock, without blocking the event loop', async () => {
    const other = await temp.open();
    const slow = other.transaction(async (tx) => {
      await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['other'] });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['mine'] });
    await slow;
    expect(await count(db)).toBe(2);
  });

  it('still commits transactions after having waited for another process (regression)', async () => {
    const other = await temp.open();
    for (let round = 0; round < 3; round += 1) {
      const slow = other.transaction(async (tx) => {
        await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['other'] });
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await db.transaction(async (tx) => {
        await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['mine'] });
      });
      await slow;
    }
    expect(await count(db)).toBe(6);
  });

  it('gives up with DatabaseBusyError when the lock is held past the deadline', async () => {
    const impatient = await temp.open({ busyDeadlineMs: 60 });
    let release: () => void = () => undefined;
    const held = db.transaction(async (tx) => {
      await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['held'] });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      impatient.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['late'] }),
    ).rejects.toBeInstanceOf(DatabaseBusyError);
    release();
    await held;
    expect(await count(db)).toBe(1);
  });

  it('rolls a transaction back when its work fails', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['lost'] });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await count(db)).toBe(0);
    await db.execute({ sql: 'INSERT INTO items (label) VALUES (?)', args: ['after'] });
    expect(await count(db)).toBe(1);
  });
});

describe('parseRow', () => {
  it('returns typed values and fails loudly on an unexpected shape', () => {
    const schema = z.object({ id: z.number(), label: z.string() });
    expect(parseRow(schema, { id: 1, label: 'a' }, 'items')).toEqual({ id: 1, label: 'a' });
    expect(() => parseRow(schema, { id: '1', label: null }, 'items')).toThrow(RowShapeError);
    expect(() => parseRow(schema, { id: '1', label: null }, 'items')).toThrow(/items: id/);
  });
});
