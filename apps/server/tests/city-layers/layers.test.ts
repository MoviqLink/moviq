import { cityLayersResponseSchema, type CityLayersResponse } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { createCityCatalog, ITEMS_PER_LAYER } from '../../src/modules/city-layers/catalog.js';
import { layerOf, part } from '../../src/modules/city-layers/layer.js';
import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import { nycParkingMeters } from '../../src/modules/data-platform/sources/street/parking-meters.js';
import { nycStreetPermitSources } from '../../src/modules/data-platform/sources/street/street-permits.js';
import { readerWith } from '../live-vehicles/reader.js';
import { manualClock } from '../support/manual-clock.js';
import { capturedAnswers, capturedReader, cityApp, NOW } from './captures.js';

const noNetwork = () => Promise.reject(new Error('No request leaves a test of the layers.'));

async function layers(query: string, reader: SourceReader = capturedReader()) {
  const response = await cityApp(reader, manualClock(NOW), noNetwork).request(
    `/api/city/layers${query}`,
  );
  expect(response.status).toBe(200);
  return cityLayersResponseSchema.parse(await response.json());
}

const summary = (answer: CityLayersResponse, layer: string) =>
  answer.layers.find((row) => row.layer === layer);

describe('city layers', () => {
  it('counts every layer of the city and serves only the layers asked for', async () => {
    const answer = await layers('?layers=incidents,cameras');
    expect(answer.asked).toEqual(['incidents', 'cameras']);
    expect(answer.layers).toHaveLength(18);
    expect(summary(answer, 'cameras')).toMatchObject({ group: 'street', status: 'live', count: 4 });
    expect(summary(answer, 'subway-entrances')).toMatchObject({ group: 'places', count: 2120 });
    expect(new Set(answer.items.map((item) => item.layer))).toEqual(
      new Set(['incidents', 'cameras']),
    );
    expect(answer.items.filter((item) => item.layer === 'incidents')).toHaveLength(3);
  });

  it('maps designated landmarks with source and official designation, and filters by map box', async () => {
    const answer = await layers('?layers=landmarks');
    expect(summary(answer, 'landmarks')).toMatchObject({ group: 'places', status: 'live' });
    const landmark = answer.items.find((item) => item.id.startsWith('landmarks:LP-02694:'));
    expect(landmark).toMatchObject({
      sourceId: 'nyc-landmarks',
      detail: { kind: 'landmark', address: '440 GRAND STREET', designatedOn: '2026-04-07' },
    });
    expect(landmark?.point).not.toBeNull();
  });

  it('asks nothing when no layer is named, and refuses an unknown layer or a wrong box', async () => {
    expect((await layers('')).items).toEqual([]);
    const app = cityApp(capturedReader(), manualClock(NOW), noNetwork);
    expect((await app.request('/api/city/layers?layers=radar')).status).toBe(400);
    expect((await app.request('/api/city/layers?bbox=1,2,3')).status).toBe(400);
  });

  it('keeps 511NY words, agency and time with each road event', async () => {
    const answer = await layers('?layers=incidents');
    const crash = answer.items.find((item) => item.id === 'incidents:TRANSCOM-ORI1238508577');
    expect(crash).toMatchObject({
      title: 'Brooklyn Bridge eastbound: Disabled vehicle.',
      sourceId: 'ny511-incidents',
      detail: { kind: 'road-event', headline: 'Disabled Vehicle', agency: 'NYSDOT', active: true },
    });
    expect(crash?.detail.kind === 'road-event' && crash.detail.updatedAt).toMatch(/^2026-11-1/);
  });

  it('cuts the drawn layers to the box and lists the unplaced ones in any box', async () => {
    const centralParkWest = '?layers=cameras,permitted-events&bbox=-73.975,40.78,-73.96,40.79';
    const answer = await layers(centralParkWest);
    const cameras = answer.items.filter((item) => item.layer === 'cameras');
    expect(cameras.map((item) => item.title)).toEqual(['Central Park West @ 86 St']);
    expect(answer.items.filter((item) => item.layer === 'permitted-events')).toHaveLength(8);
  });

  it('never draws a street permit, nor makes one a closure: it is counted by borough', async () => {
    const answer = await layers('?layers=street-permits,closures');
    expect(summary(answer, 'street-permits')).toMatchObject({
      count: 6,
      breakdown: [{ label: 'Staten Island', count: 6 }],
      status: 'degraded',
    });
    const permitIds = new Set(nycStreetPermitSources.map((source) => source.id));
    expect(answer.items.filter((item) => item.layer === 'street-permits')).toEqual([]);
    expect(answer.items.some((item) => permitIds.has(item.sourceId))).toBe(false);
    const closures = answer.items.filter((item) => item.layer === 'closures');
    expect(new Set(closures.map((item) => item.sourceId))).toEqual(
      new Set(['ny511-closures', 'nyc-street-closures-today']),
    );
  });

  it('gives each permitted event the closure its permit states, or none, and its stretches', async () => {
    const answer = await layers('?layers=permitted-events');
    const parade = answer.items.find((item) => item.id === 'permitted-events:899286');
    expect(parade?.detail).toMatchObject({
      kind: 'permitted-event',
      closure: 'Full Street Closure',
      stretches: [{ startsAt: '2026-11-11T15:00:00.000Z', endsAt: '2026-11-11T23:00:00.000Z' }],
    });
    const playground = answer.items.find((item) => item.id === 'permitted-events:796129');
    // A path closed from 2024 to 2026 keeps its real start, with its one stretch.
    expect(playground?.detail).toMatchObject({
      closure: null,
      startsAt: '2024-06-30T12:00:00.000Z',
      stretches: [{ startsAt: '2024-06-30T12:00:00.000Z', endsAt: '2027-01-01T04:00:00.000Z' }],
    });
  });

  it('lists the public restrooms in service with their facts as published', async () => {
    const answer = await layers('?layers=restrooms');
    expect(summary(answer, 'restrooms')).toMatchObject({ group: 'places', count: 17 });
    const virginia = answer.items.find((item) => item.title === 'Virginia Playground');
    expect(virginia).toMatchObject({
      sourceId: 'nyc-public-restrooms',
      point: [-73.8622, 40.83433],
      detail: {
        kind: 'restroom',
        hours: '8am-4pm, Open later seasonally',
        access: 'full',
        keyOrCode: false,
      },
    });
    const titles = answer.items.map((item) => item.title);
    expect(titles).not.toContain('Charybdis Playground');
    expect(new Set(answer.items.map((item) => item.id)).size).toBe(17);
  });

  it('shows the harbor as NOAA measures it, with the place NOAA gives each station', async () => {
    const answer = await layers('?layers=harbor-conditions,vessel-calls,coast-guard');
    const airGap = answer.items.find((item) => item.id === 'harbor-conditions:8517986:air-gap');
    expect(airGap).toMatchObject({
      point: [-74.0448, 40.6062],
      detail: { observedAt: '2026-11-11T03:30:00.000Z', reading: { metres: 69.794 } },
    });
    const calls = answer.items.filter((item) => item.layer === 'vessel-calls');
    expect(calls.every((item) => item.point === null)).toBe(true);
    expect(calls.map((item) => item.title)).not.toContain('TEST VESSEL 02');
    expect(summary(answer, 'coast-guard')?.count).toBe(8);
  });

  it('says a layer is unavailable when its sources have nothing, never that it is empty', async () => {
    const answer = await layers('?layers=incidents', readerWith(new Map(), NOW));
    expect(summary(answer, 'incidents')).toMatchObject({ status: 'unavailable', count: 0 });
    expect(
      answer.sources.find((source) => source.provenance.sourceId === 'ny511-incidents'),
    ).toMatchObject({ attribution: 'Powered by 511NY', provenance: { state: 'unavailable' } });
  });

  it('reads the sources once every 15 seconds for every screen', async () => {
    const reads: string[] = [];
    const inner = capturedReader();
    const counting: SourceReader = {
      read(definition) {
        reads.push(definition.id);
        return inner.read(definition);
      },
    };
    const clock = manualClock(NOW);
    const catalog = createCityCatalog({ reader: counting, clock });
    const query = { box: undefined, layers: new Set(['cameras'] as const) };
    await catalog.list(query);
    const once = reads.length;
    clock.advance(14_000);
    await catalog.list(query);
    expect(reads).toHaveLength(once);
    clock.advance(1_000);
    await catalog.list(query);
    expect(reads).toHaveLength(2 * once);
  });

  it('leaves out an item that breaks the contract and counts it', async () => {
    const odd = layerOf('parking-meters', 'places', [
      part({
        source: nycParkingMeters,
        items: (data) =>
          data.meters.map((meter, index) => ({
            id: `parking-meters:${meter.id}`,
            layer: 'parking-meters' as const,
            sourceId: nycParkingMeters.id,
            title: index === 0 ? '' : meter.id,
            point: meter.point,
            lines: [],
            detail: { kind: 'subway-entrance' as const, type: 'Stair', entry: true, exit: true },
          })),
      }),
    ]);
    const catalog = createCityCatalog({
      reader: readerWith(capturedAnswers(), NOW),
      clock: manualClock(NOW),
      layers: [odd],
    });
    const answer = await catalog.list({ box: undefined, layers: new Set(['parking-meters']) });
    expect(answer.layers[0]).toMatchObject({ count: 6, leftOut: 1 });
  });

  it('caps a layer with too many items in the box and says how many it holds', async () => {
    const many = layerOf('parking-meters', 'places', [
      part({
        source: nycParkingMeters,
        items: (data) =>
          Array.from({ length: ITEMS_PER_LAYER + 1 }, (_, index) => ({
            id: `parking-meters:${String(index)}`,
            layer: 'parking-meters' as const,
            sourceId: nycParkingMeters.id,
            title: 'Meter',
            point: data.meters[0]?.point ?? null,
            lines: [],
            detail: {
              kind: 'parking-meter' as const,
              hours: null,
              facility: null,
              street: null,
              side: null,
              from: null,
              to: null,
            },
          })),
      }),
    ]);
    const catalog = createCityCatalog({
      reader: readerWith(capturedAnswers(), NOW),
      clock: manualClock(NOW),
      layers: [many],
    });
    const answer = await catalog.list({ box: undefined, layers: new Set(['parking-meters']) });
    expect(answer.items).toEqual([]);
    expect(answer.capped).toEqual([{ layer: 'parking-meters', inBox: ITEMS_PER_LAYER + 1 }]);
  });
});
