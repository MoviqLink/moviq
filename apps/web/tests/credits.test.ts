import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CREDIT_GROUPS,
  NYC_DOT_DISCLAIMER,
  catalogueSources,
} from '../src/features/credits/sources';
import { creditsEn, creditsEs } from '../src/features/credits/texts';

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** The catalogue as `npm run docs:sources` writes it from the server's source definitions. */
const catalogue = readFileSync(repo('docs/data-sources.md'), 'utf8');
const catalogueIds = [...catalogue.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
const catalogueCredits = (catalogue.split('## Credits')[1] ?? '')
  .split('\n')
  .filter((line) => line.startsWith('- '))
  .map((line) => line.slice(2).trim());

const credits = CREDIT_GROUPS.flatMap((group) => group.credits);
const lines = credits.flatMap((credit) => credit.attribution);

describe('the credits page', () => {
  it('credits every source of the catalogue exactly once, and nothing outside it', () => {
    expect(catalogueIds.length).toBeGreaterThan(90);
    const credited = catalogueSources(CREDIT_GROUPS);
    expect(new Set(credited).size).toBe(credited.length);
    expect([...credited].sort()).toEqual([...catalogueIds].sort());
  });

  it('carries every credit line of the catalogue word for word', () => {
    expect(catalogueCredits.length).toBeGreaterThan(30);
    for (const line of catalogueCredits) expect(lines).toContain(line);
  });

  it('carries the credits the licences of the maps, flights and routing ask for', () => {
    for (const line of [
      'Flight data by AeroDataBox',
      'Powered by 511NY',
      '© OpenStreetMap contributors',
      'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
      'NYS ITS Geospatial Services',
      'Routing by Transitous, map data © OpenStreetMap contributors',
      'Event data from the Ticketmaster Discovery API',
      'Radar: NOAA National Weather Service (public domain)',
    ]) {
      expect(lines).toContain(line);
    }
    const licences = credits.map((credit) => credit.licence.name);
    expect(licences).toContain('Open Data Commons Attribution License (ODC-By) 1.0');
    expect(licences).toContain('Open Database License (ODbL) 1.0');
  });

  it('never shows the bike share operator’s marks', () => {
    const shown = [
      ...lines,
      ...credits.map((credit) => credit.licence.name),
      ...[creditsEn, creditsEs].flatMap((t) =>
        Object.values(t.credits).flatMap((words) => [words.name, words.what]),
      ),
    ];
    for (const text of shown) expect(text).not.toMatch(/citi\s*bike/i);
  });

  it('carries the notice NYC DOT asks for, word for word', () => {
    expect(NYC_DOT_DISCLAIMER).toMatch(/^This application may contain and\/or utilize information/);
    expect(NYC_DOT_DISCLAIMER).toMatch(/observe posted signage .+ laws and regulations\.$/);
  });

  it('says where each line comes from, in files that exist', () => {
    for (const credit of credits) {
      expect(credit.basis.length).toBeGreaterThan(0);
      for (const file of credit.basis) expect(existsSync(repo(file)), file).toBe(true);
    }
  });

  it('links each licence that has a page over HTTPS', () => {
    for (const credit of credits) {
      if (credit.licence.url !== null) expect(credit.licence.url).toMatch(/^https:\/\//);
    }
  });

  it('names every credit and group in both languages, with no words left unused', () => {
    const ids = credits.map((credit) => credit.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of [creditsEn, creditsEs]) {
      expect(Object.keys(t.credits).sort()).toEqual([...ids].sort());
      expect(Object.keys(t.groups).sort()).toEqual(CREDIT_GROUPS.map((group) => group.id).sort());
    }
  });
});
