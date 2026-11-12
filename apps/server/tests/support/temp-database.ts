import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, type Database } from '../../src/infrastructure/database/database.js';

export interface TempDatabase {
  readonly url: string;
  /** Opens another connection to the same file, as a second process would. */
  open(options?: { busyDeadlineMs?: number }): Promise<Database>;
  /** Closes every connection opened here and deletes the file. */
  dispose(): Promise<void>;
}

/** A real SQLite file in a fresh temporary folder, so each test starts from an empty database. */
export async function tempDatabase(): Promise<TempDatabase> {
  const folder = await mkdtemp(join(tmpdir(), 'moviq-test-'));
  const url = `file:${join(folder, 'test.db')}`;
  const opened: Database[] = [];
  return {
    url,
    async open(options = {}) {
      const db = await openDatabase({
        url,
        authToken: undefined,
        baseDirectory: folder,
        ...options,
      });
      opened.push(db);
      return db;
    },
    async dispose() {
      for (const db of opened) db.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
