import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import {
  inspectMigrations,
  migrate,
  MigrationError,
  readMigrations,
  type Migration,
} from '../src/infrastructure/database/migrations.js';
import { manualClock } from './support/manual-clock.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const REAL_MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const clock = manualClock();

let temp: TempDatabase;
let folder: string;

beforeEach(async () => {
  temp = await tempDatabase();
  folder = await mkdtemp(join(tmpdir(), 'moviq-migrations-'));
});

afterEach(async () => {
  await temp.dispose();
  await rm(folder, { recursive: true, force: true });
});

async function files(entries: Record<string, string>): Promise<readonly Migration[]> {
  for (const [name, sql] of Object.entries(entries)) await writeFile(join(folder, name), sql);
  return readMigrations(folder);
}

describe('readMigrations', () => {
  it('reads numbered files in order with a checksum', async () => {
    const migrations = await files({
      '0002_second.sql': 'CREATE TABLE b (x INTEGER);',
      '0001_first.sql': 'CREATE TABLE a (x INTEGER);',
    });
    expect(migrations.map((m) => [m.version, m.name])).toEqual([
      [1, 'first'],
      [2, 'second'],
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects bad names and gaps in the sequence', async () => {
    await expect(files({ '1_bad.sql': '' })).rejects.toThrow('Invalid migration file name');
    await rm(join(folder, '1_bad.sql'));
    await expect(files({ '0001_a.sql': '', '0003_c.sql': '' })).rejects.toThrow(
      'expected version 2',
    );
  });
});

describe('migrate', () => {
  it('applies every migration once and records it', async () => {
    const db = await temp.open();
    const migrations = await files({
      '0001_first.sql': 'CREATE TABLE a (x INTEGER);',
      '0002_second.sql': 'CREATE TABLE b (x INTEGER); CREATE TABLE c (x INTEGER);',
    });
    expect(await migrate(db, migrations, clock)).toEqual([1, 2]);
    expect(await migrate(db, migrations, clock)).toEqual([]);
    expect(await inspectMigrations(db, migrations)).toEqual({
      applied: 2,
      pending: 0,
      problems: [],
    });
    const ledger = await db.query('SELECT version, applied_at FROM schema_migrations');
    expect(ledger.rows[0]?.['applied_at']).toBe('2026-11-11T12:00:00.000Z');
  });

  it('is safe when two processes migrate the same database at once', async () => {
    const [first, second] = await Promise.all([temp.open(), temp.open()]);
    const migrations = await files({
      '0001_first.sql': 'CREATE TABLE a (x INTEGER);',
      '0002_second.sql': 'CREATE TABLE b (x INTEGER);',
    });
    const results = await Promise.all([
      migrate(first, migrations, clock),
      migrate(second, migrations, clock),
    ]);
    expect(results.flat().sort()).toEqual([1, 2]);
  });

  it('refuses a migration another process applied with different content meanwhile (regression)', async () => {
    const [mine, theirs] = await Promise.all([temp.open(), temp.open()]);
    const ours = await files({ '0001_first.sql': 'CREATE TABLE a (x INTEGER);' });
    const [first] = ours;
    if (first === undefined) throw new Error('migration file missing');
    const other: readonly Migration[] = [
      { ...first, sql: 'CREATE TABLE a (y TEXT);', checksum: 'f'.repeat(64) },
    ];
    let raced = false;
    // The other process applies its version after our first check and before our transaction.
    const racing: Database = {
      ...mine,
      transaction: async (work) => {
        if (!raced) {
          raced = true;
          await migrate(theirs, other, clock);
        }
        return mine.transaction(work);
      },
    };
    await expect(migrate(racing, ours, clock)).rejects.toThrow(
      'Migration 1 (first) changed after it was applied.',
    );
  });

  it('applies nothing of a migration that fails', async () => {
    const db = await temp.open();
    const migrations = await files({ '0001_broken.sql': 'CREATE TABLE a (x INTEGER); NOT SQL;' });
    await expect(migrate(db, migrations, clock)).rejects.toThrow();
    const tables = await db.query("SELECT name FROM sqlite_master WHERE name = 'a'");
    expect(tables.rows).toHaveLength(0);
    expect(await inspectMigrations(db, migrations)).toMatchObject({ applied: 0, pending: 1 });
  });

  it('refuses to run when an applied migration changed or is unknown to the code', async () => {
    const db = await temp.open();
    const original = await files({ '0001_first.sql': 'CREATE TABLE a (x INTEGER);' });
    await migrate(db, original, clock);
    const edited = await files({ '0001_first.sql': 'CREATE TABLE a (x INTEGER, y TEXT);' });
    await expect(migrate(db, edited, clock)).rejects.toBeInstanceOf(MigrationError);
    expect((await inspectMigrations(db, edited)).problems).toEqual([
      'Migration 1 (first) changed after it was applied.',
    ]);
    expect((await inspectMigrations(db, [])).problems).toEqual([
      'The database has migration 1, which this code does not know.',
    ]);
  });

  it('reports every migration as pending on a database never migrated', async () => {
    const db = await temp.open();
    const migrations = await readMigrations(REAL_MIGRATIONS);
    expect(await inspectMigrations(db, migrations)).toEqual({
      applied: 0,
      pending: migrations.length,
      problems: [],
    });
  });

  it('applies the real migrations of the repository on an empty database', async () => {
    const db = await temp.open();
    const migrations = await readMigrations(REAL_MIGRATIONS);
    expect(migrations.length).toBeGreaterThan(0);
    await migrate(db, migrations, clock);
    expect(await inspectMigrations(db, migrations)).toMatchObject({ pending: 0, problems: [] });
  });
});
