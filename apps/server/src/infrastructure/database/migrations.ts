import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../clock/clock.js';
import type { Database } from './database.js';
import { parseRow } from './rows.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationStatus {
  readonly applied: number;
  readonly pending: number;
  readonly problems: readonly string[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const appliedRowSchema = z.object({ version: z.number().int().positive(), checksum: z.string() });

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const CREATE_LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

/** Reads `NNNN_name.sql` files. Versions must start at 1 and have no gaps. */
export async function readMigrations(directory: string): Promise<readonly Migration[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (match === null) throw new MigrationError(`Invalid migration file name: ${file}`);
    const version = Number(match[1]);
    if (version !== migrations.length + 1) {
      throw new MigrationError(
        `Migration ${file} breaks the sequence: expected version ${String(migrations.length + 1)}`,
      );
    }
    const sql = (await readFile(join(directory, file), 'utf8')).replaceAll('\r\n', '\n');
    migrations.push({ version, name: match[2] ?? '', sql, checksum: sha256(sql) });
  }
  return migrations;
}

/**
 * Applies pending migrations, each in its own write transaction. Safe to run from several
 * processes at once: a migration another process already applied is skipped.
 */
export async function migrate(
  db: Database,
  migrations: readonly Migration[],
  clock: Clock,
): Promise<readonly number[]> {
  await db.execute(CREATE_LEDGER);
  const problems = compare(await appliedChecksums(db), migrations).problems;
  if (problems.length > 0) throw new MigrationError(problems.join(' '));

  const appliedNow: number[] = [];
  for (const migration of migrations) {
    const applied = await db.transaction(async (tx) => {
      // Another process may have applied this version since the check above: it must be the same.
      const existing = await tx.execute({
        sql: 'SELECT version, checksum FROM schema_migrations WHERE version = ?',
        args: [migration.version],
      });
      if (existing.rows.length > 0) {
        const row = parseRow(appliedRowSchema, existing.rows[0], 'schema_migrations');
        if (row.checksum !== migration.checksum)
          throw new MigrationError(changedMessage(migration));
        return false;
      }
      await tx.executeMultiple(migration.sql);
      await tx.execute({
        sql: 'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        args: [migration.version, migration.name, migration.checksum, toInstant(clock.now())],
      });
      return true;
    });
    if (applied) appliedNow.push(migration.version);
  }
  return appliedNow;
}

/** Compares the database with the migration files without changing anything. */
export async function inspectMigrations(
  db: Database,
  migrations: readonly Migration[],
): Promise<MigrationStatus> {
  const ledger = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (ledger.rows.length === 0) {
    return { applied: 0, pending: migrations.length, problems: [] };
  }
  return compare(await appliedChecksums(db), migrations);
}

async function appliedChecksums(db: Database): Promise<ReadonlyMap<number, string>> {
  const result = await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const rows = result.rows.map((row) => parseRow(appliedRowSchema, row, 'schema_migrations'));
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

function compare(
  applied: ReadonlyMap<number, string>,
  migrations: readonly Migration[],
): MigrationStatus {
  const problems: string[] = [];
  const known = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const [version, checksum] of applied) {
    const migration = known.get(version);
    if (migration === undefined) {
      problems.push(
        `The database has migration ${String(version)}, which this code does not know.`,
      );
    } else if (migration.checksum !== checksum) {
      problems.push(changedMessage(migration));
    }
  }
  const pending = migrations.filter((migration) => !applied.has(migration.version)).length;
  return { applied: applied.size, pending, problems };
}

function changedMessage(migration: Migration): string {
  return `Migration ${String(migration.version)} (${migration.name}) changed after it was applied.`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
