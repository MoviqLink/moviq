import { readFileSync } from 'node:fs';

import protobuf from 'protobufjs';
import { describe, expect, it, vi } from 'vitest';

import { decode, type Plain } from '../src/gtfs-rt/feed.js';
import { parseProto } from '../src/gtfs-rt/schema.js';
import { partOf, splitFeed } from '../src/gtfs-rt/split.js';
import type { RecordedSource } from '../src/sources.js';
import { fixture } from './support.js';

const PROTO = readFileSync(
  new URL('../../server/vendor/gtfs-realtime.proto', import.meta.url),
  'utf8',
);
const FEED = 'transit_realtime.FeedMessage';

/** Each real capture of `tests/fixtures/` and the source that reads it. */
const CAPTURES: Readonly<Record<string, string>> = {
  'ferries/ny-waterway-positions.pb': 'ny-waterway-positions',
  'ferries/nyc-ferry-positions.pb': 'nyc-ferry-positions',
  'mta/alerts.pb': 'mta-alerts',
  'mta/bus-trip-updates.pb': 'mta-bus-trip-updates',
  'mta/bus-vehicle-positions.pb': 'mta-bus-positions',
  'mta/subway-1234567.pb': 'mta-subway-1234567',
  'mta/subway-ace.pb': 'mta-subway-ace',
  'mta/subway-bdfm.pb': 'mta-subway-bdfm',
  'mta/subway-g.pb': 'mta-subway-g',
  'mta/subway-jz.pb': 'mta-subway-jz',
  'mta/subway-l.pb': 'mta-subway-l',
  'mta/subway-nqrw.pb': 'mta-subway-nqrw',
  'mta/subway-sir.pb': 'mta-subway-sir',
  'regional/lirr-realtime.pb': 'mta-lirr-realtime',
  'regional/metro-north-realtime.pb': 'mta-metro-north-realtime',
  'shuttles/ewr-shuttle-positions.pb': 'ewr-shuttle-positions',
  'shuttles/jfk-lga-shuttle-positions.pb': 'jfk-lga-shuttle-positions',
  'westchester/bee-line-positions.pb': 'bee-line-positions',
};

type Sources = readonly RecordedSource[];

/** The recorded sources with protobufjs, then again with the Worker's stand-in for it. */
async function bothWays(): Promise<{ real: Sources; worker: Sources }> {
  vi.resetModules();
  const real: { recordedSources: Sources } = await import('../src/sources.js');
  vi.resetModules();
  vi.doMock('protobufjs', () => import('../src/runtime/protobufjs.js'));
  const worker: { recordedSources: Sources } = await import('../src/sources.js');
  vi.doUnmock('protobufjs');
  return { real: real.recordedSources, worker: worker.recordedSources };
}

const feed = (bytes: Uint8Array): Plain =>
  decode(parseProto(PROTO), FEED, bytes, { enumNames: true });

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array);

const idOf = (entity: Plain): string => (typeof entity['id'] === 'string' ? entity['id'] : '');

const entities = (message: Plain): Plain[] => {
  const list = message['entity'];
  return Array.isArray(list) ? list.filter(isPlain) : [];
};

describe('the protobuf decoder of the Worker', () => {
  it('decodes every real capture exactly as protobufjs toObject does', () => {
    const type = protobuf.parse(PROTO, { keepCase: true }).root.lookupType(FEED);
    for (const capture of Object.keys(CAPTURES)) {
      const body = fixture(capture);
      const options = { enums: String, longs: Number, defaults: false };
      expect(feed(body), capture).toEqual(type.toObject(type.decode(body), options));
    }
  });

  it('gives each source the same data with protobufjs and without it', async () => {
    const { real, worker } = await bothWays();
    const context = { receivedAt: new Date('2026-11-11T10:10:00.000Z'), previous: undefined };
    for (const [capture, sourceId] of Object.entries(CAPTURES)) {
      const body = fixture(capture);
      const find = (sources: Sources) =>
        sources.find((source) => source.definition.id === sourceId)?.definition;
      const expected = find(real)?.parse(body, context);
      expect(expected, sourceId).toBeDefined();
      expect(find(worker)?.parse(body, context), sourceId).toEqual(expected);
    }
  });

  it('refuses a truncated feed and one without its header', () => {
    const body = fixture('mta/subway-ace.pb');
    expect(() => feed(body.subarray(0, body.byteLength - 7))).toThrow(RangeError);
    const headless = new Uint8Array([0x12, 0x03, 0x0a, 0x01, 0x61]);
    expect(() => feed(headless)).toThrow(/missing required 'header'/);
  });

  it('reads packed repeated fields, zigzag and fixed numbers as protobufjs does', () => {
    const text = `syntax = "proto2";
      message M { repeated uint32 a = 1 [packed = true]; optional sint32 b = 2;
        optional fixed32 c = 3; optional sfixed64 d = 4; }`;
    const type = protobuf.parse(text, { keepCase: true }).root.lookupType('M');
    const value = { a: [1, 300, 70000], b: -5, c: 4_000_000_000, d: -2 };
    const bytes = type.encode(type.fromObject(value)).finish();
    expect(decode(parseProto(text), 'M', bytes, { enumNames: false })).toEqual(
      type.toObject(type.decode(bytes), { longs: Number }),
    );
  });
});

describe('splitting a feed by entity', () => {
  it('keeps the header in every part and every entity in exactly one, by its id', () => {
    const body = fixture('mta/bus-trip-updates.pb');
    const whole = feed(body);
    const parts = splitFeed(body, 8).map((part) => feed(part.body));
    for (const part of parts) expect(part['header']).toEqual(whole['header']);
    const ids = parts.flatMap((part, index) =>
      entities(part).map((entity) => {
        expect(partOf(idOf(entity), 8)).toBe(index);
        return idOf(entity);
      }),
    );
    expect(ids.sort()).toEqual(entities(whole).map(idOf).sort());
  });

  it('puts an id in the same part every time, and a feed of one part stays whole', () => {
    expect(partOf('MTA NYCT_7113', 8)).toBe(partOf('MTA NYCT_7113', 8));
    const body = fixture('mta/subway-g.pb');
    expect(splitFeed(body, 1)).toEqual([{ body, entities: undefined }]);
  });
});
