import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { locateDatabase, openDatabase } from '../src/infrastructure/database/database.js';

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'moviq-location-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('locateDatabase', () => {
  it('resolves a relative path against the server folder, not the working directory', () => {
    const location = locateDatabase('file:data/moviq.db', '/srv/moviq/apps/server');
    expect(location).toMatchObject({ kind: 'file', path: '/srv/moviq/apps/server/data/moviq.db' });
  });

  it('understands absolute paths, file:// URLs, localhost and percent-encoding', () => {
    expect(locateDatabase('file:/var/data/a.db', '/x')).toMatchObject({ path: '/var/data/a.db' });
    expect(locateDatabase('file:///var/my%20data/a.db', '/x')).toMatchObject({
      path: '/var/my data/a.db',
    });
    expect(locateDatabase('file://localhost/var/a.db', '/x')).toMatchObject({ path: '/var/a.db' });
    expect(locateDatabase('file:my%20data/a.db', '/x')).toMatchObject({ path: '/x/my data/a.db' });
  });

  it('keeps remote URLs as they are and refuses in-memory databases', () => {
    expect(locateDatabase('libsql://db.example.io', '/x')).toEqual({
      kind: 'remote',
      url: 'libsql://db.example.io',
    });
    expect(() => locateDatabase('file::memory:', '/x')).toThrow(/in-memory/);
  });
});

describe('openDatabase with a path that needs encoding (regression)', () => {
  it('creates and opens the same folder, with no literal %20 left behind', async () => {
    const url = pathToFileURL(join(folder, 'with space', 'test.db')).href;
    expect(url).toContain('%20');
    const db = await openDatabase({ url, authToken: undefined, baseDirectory: folder });
    await db.execute('CREATE TABLE t (x INTEGER)');
    db.close();
    expect((await readdir(folder)).sort()).toEqual(['with space']);
    expect(await readdir(join(folder, 'with space'))).toContain('test.db');
  });
});
