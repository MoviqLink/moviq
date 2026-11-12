import { describe, expect, it } from 'vitest';

import { nycPublicRestrooms } from '../../../src/modules/data-platform/sources/street/public-restrooms.js';
import { accepted, capture, captureJson, text } from '../ny511/captures.js';

const at = { receivedAt: new Date('2026-11-11T14:45:58Z'), previous: undefined };
const parse = () =>
  accepted(nycPublicRestrooms.parse(capture('street', 'public-restrooms.json'), at));
const named = (name: string) => parse().data.restrooms.find((restroom) => restroom.name === name);

describe('NYC public restrooms', () => {
  it('serves only those in service, once each, and counts the rest', () => {
    const result = parse();
    expect(result.coverage).toBe('17 restrooms in service, 3 not in service, 0 left out');
    expect(result.data).toMatchObject({ notInService: 3, staffOnly: 1, leftOut: 0 });
    const names = result.data.restrooms.map((restroom) => restroom.name);
    for (const closed of [
      'Charybdis Playground',
      'Gravesend Library, BPL',
      'Terence Cardinal Cooke-Cathedral Library, NYPL',
      'MADE Campus/Bush Terminal - Building B',
    ]) {
      expect(names).not.toContain(closed);
    }
    expect(names.filter((name) => name === 'Tompkins Square Park')).toHaveLength(1);
    expect(nycPublicRestrooms.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
  });

  it('keeps the hours as published, line by line, with the portal spaces made single', () => {
    expect(named('Virginia Playground')?.facts.hours).toBe('8am-4pm, Open later seasonally');
    const central = named('Brooklyn Central Library, BPL')?.facts.hours ?? '';
    expect(central.split('\n')[0]).toMatch(/^Monday \d/);
    expect(central).not.toMatch(/\t| {2}| $/m);
    expect(named('Parkchester Library, NYPL')?.facts.hours?.split('\n')[0]).toBe('Sunday: Closed');
  });

  it('reads access, stalls, changing tables, season, keys and the official page', () => {
    expect(named('Virginia Playground')?.facts).toMatchObject({
      placeType: 'Park',
      operator: 'NYC Parks',
      access: 'full',
      season: 'year-round',
      keyOrCode: false,
      website: null,
    });
    expect(named('Rienzi Playground')?.facts.changingTable).toBe('women');
    expect(named('Park Of The Americas')?.facts).toMatchObject({
      season: 'seasonal',
      access: 'none',
    });
    expect(named('Kew Gardens Hills Library, QPL')?.facts.access).toBe('limited');
    const windsor = named('Windsor Park Library, QPL')?.facts;
    expect(windsor).toMatchObject({ keyOrCode: true, note: 'Yes, a key is needed to enter' });
    expect(windsor?.website).toMatch(/^https:\/\/www\.queenslibrary\.org\//);
    expect(named('Grand Central (Metro North) LIRR Restroom')?.facts.access).toBeNull();
    expect(named('Milestone Park Modular')?.facts).toMatchObject({
      operator: 'Throne Labs',
      keyOrCode: false,
    });
  });

  it('refuses a cut list, and an answer that is not a list', () => {
    expect(nycPublicRestrooms.check?.(parse().data, undefined)).toEqual([
      '17 restrooms, minimum 700',
    ]);
    const refused = nycPublicRestrooms.parse(text('{"error":true}'), at);
    expect(refused).toMatchObject({ ok: false, code: 'unexpected-shape' });
  });

  it('leaves out a row without a place and keeps the others', () => {
    const rows = captureJson('street', 'public-restrooms.json') as Record<string, unknown>[];
    const broken = rows.map((row, index) => (index === 1 ? { ...row, latitude: 'x' } : row));
    const result = accepted(nycPublicRestrooms.parse(text(JSON.stringify(broken)), at));
    expect(result.data.leftOut).toBe(1);
  });

  it('asks only the columns it reads, from NYC Open Data', () => {
    const { url } = nycPublicRestrooms.request({ now: at.receivedAt, credentials: {} });
    expect(url).toContain('data.cityofnewyork.us/resource/i7jb-7jku.json?$select=facility_name');
    expect(nycPublicRestrooms.licence.attribution).toContain('i7jb-7jku');
  });
});
