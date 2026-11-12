import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  cityItemSchema,
  cityLayersResponseSchema,
  liveModeSchema,
  liveVehiclesResponseSchema,
  type LiveSource,
} from '@moviq/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { layerAge } from '../../src/features/explore/city/model/panel';
import { cardEs } from '../../src/features/explore/city/texts-card-es';
import { cityEs } from '../../src/features/explore/city/texts-es';
import { CityCard } from '../../src/features/explore/city/ui/CityCard';
import { PermittedEventBody } from '../../src/features/explore/city/ui/StreetBodies';
import { FIRST_HIDDEN, modesShown } from '../../src/features/explore/model/shown';
import { oldestAge, publishedDay, sourceAge } from '../../src/features/explore/model/source';
import { exploreEs } from '../../src/features/explore/texts-es';
import { Overview } from '../../src/features/explore/ui/Overview';
import { SourceCredit } from '../../src/features/explore/ui/SourceCredit';
import { VehicleCard } from '../../src/features/explore/ui/VehicleCard';
import live from './fixtures/live-city.json';

// The panel is rendered in English whatever the language of the machine running the tests.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
});

const city = liveVehiclesResponseSchema.parse(live);
const layers = cityLayersResponseSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/city-layers.json', import.meta.url)), 'utf8'),
  ),
);

function source(id: string): LiveSource {
  const found = city.sources.find((candidate) => candidate.provenance.sourceId === id);
  if (found === undefined) throw new Error(`${id} is in the capture`);
  return found;
}

const nothing = () => undefined;

/** The panel over the captures, in English: the live city, the city layers, no events. */
function panel(destination: string | null = null): string {
  return renderToStaticMarkup(
    createElement(Overview, {
      live: {
        data: city,
        receivedAt: Date.parse(city.generatedAt),
        failing: false,
        retryNow: nothing,
      },
      events: {
        on: false,
        range: 'today',
        category: null,
        data: null,
        failing: false,
        toggle: nothing,
        setRange: nothing,
        setCategory: nothing,
      },
      city: {
        on: new Set(['incidents'] as const),
        toggle: nothing,
        data: layers,
        failing: false,
        signs: null,
        items: layers.items,
        drawn: [],
      },
      radar: { on: false, toggle: nothing, askedAt: null },
      box: [-74.26, 40.49, -73.69, 40.92],
      hidden: FIRST_HIDDEN,
      onToggle: nothing,
      center: [-73.95, 40.74],
      vehicles: city.vehicles,
      now: Date.parse(city.generatedAt),
      onOpen: nothing,
      destination,
    }),
  );
}

describe('Explore opens readable', () => {
  it('explains the scope of tourist mode and still exposes the events layer', () => {
    const html = panel('tourist');
    expect(html).toContain('Tourist mode');
    expect(html).toContain('Tourist experiences are not available here yet.');
    expect(html).toContain('Show events on the map');
  });

  it('shows landmark provenance, designation and a way to plan without claiming opening hours', () => {
    const item = cityItemSchema.parse({
      id: 'landmarks:test',
      layer: 'landmarks',
      sourceId: 'nyc-landmarks',
      title: 'Example landmark',
      point: [-73.9, 40.7],
      lines: [],
      detail: {
        kind: 'landmark',
        address: '1 Example Street',
        borough: 'MN',
        designatedOn: '2026-04-07',
      },
    });
    const html = renderToStaticMarkup(
      createElement(CityCard, {
        item,
        source: { title: 'NYC individual landmarks', attribution: 'NYC LPC', age: null },
        now: 0,
        onClose: nothing,
      }),
    );
    expect(html).toContain('NYC individual landmarks');
    expect(html).toContain('1 Example Street');
    expect(html).toContain('Plan a trip with Sara');
    expect(html).toContain('does not guarantee public access or opening hours');
  });

  it('starts with bike share and parked scooters and bikes off, and asks every other mode', () => {
    expect([...FIRST_HIDDEN].sort()).toEqual(['bike-station', 'micromobility']);
    const asked = modesShown(FIRST_HIDDEN);
    expect(asked).not.toContain('bike-station');
    expect(asked).not.toContain('micromobility');
    expect(asked).toHaveLength(liveModeSchema.options.length - 2);
  });

  it('leaves the list of every source to the control room, while each mode keeps its state', () => {
    const html = panel();
    expect(html).not.toContain('<summary>Sources</summary>');
    expect(html).not.toContain('MTA Bus Time vehicle positions');
    expect(html).not.toContain('Powered by 511NY');
    // The ferries have no capture here: their row says so, never an empty map.
    expect(html).toMatch(/Show Ferries on the map.*?Not available now/s);
    expect(html).toContain('aria-pressed="false" aria-label="Show Bike share on the map"');
  });
});

describe('the age of a source, as the traveller reads it', () => {
  it('dates a timetable by the day it was published, and live data by its age', () => {
    const timetable = source('mta-gtfs-subway');
    expect(timetable.kind).toBe('static');
    expect(sourceAge(timetable)).toEqual({ kind: 'published', at: '2026-10-28T04:00:00.000Z' });
    const positions = source('mta-bus-positions');
    expect(sourceAge(positions)).toEqual({
      kind: 'age',
      seconds: positions.provenance.ageSeconds,
    });
  });

  it('never calls a file the provider does not date “published”: it was read so long ago', () => {
    const entrances = layers.sources.find(
      (candidate) => candidate.provenance.sourceId === 'mta-subway-entrances',
    );
    expect(entrances?.kind).toBe('static');
    expect(entrances === undefined ? null : sourceAge(entrances)?.kind).toBe('age');
  });

  it('dates what comes from several sources by its oldest live data, or its oldest timetable', () => {
    const buses = ['mta-gtfs-bus-queens', 'mta-bus-positions', 'mta-bus-trip-updates'];
    const ages = buses.map((id) => source(id).provenance.ageSeconds ?? 0);
    expect(oldestAge(buses.map(source))).toEqual({
      kind: 'age',
      seconds: Math.max(...ages.slice(1)),
    });
    expect(oldestAge(['mta-gtfs-bus-company', 'mta-gtfs-bus-queens'].map(source))).toEqual({
      kind: 'published',
      at: '2026-10-09T04:00:00.000Z',
    });
    expect(oldestAge([])).toBeNull();
    const entrances = layers.layers.find((summary) => summary.layer === 'subway-entrances');
    expect(entrances === undefined ? null : layerAge(entrances, layers.sources)?.kind).toBe('age');
  });

  it('writes a timetable in force with its day of publication, in English and Spanish', () => {
    const html = renderToStaticMarkup(
      createElement(SourceCredit, { source: source('mta-gtfs-subway') }),
    );
    expect(html).toContain('timetable in force, published on October 28, 2026');
    expect(html).not.toMatch(/data \d/);
    const day = publishedDay('2026-10-28T04:00:00.000Z', 'es-ES');
    expect(exploreEs.timetableInForce(day)).toBe(
      'horario vigente, publicado el 28 de octubre de 2026',
    );
    expect(cityEs.inForce(day)).toBe('vigente, publicada el 28 de octubre de 2026');
    expect(cardEs.inForce(day)).toBe('vigente, publicada el 28 de octubre de 2026');
  });

  it('writes live data with its age, and its credit with its addresses as links', () => {
    const html = renderToStaticMarkup(
      createElement(SourceCredit, { source: source('mta-bus-positions') }),
    );
    expect(html).toContain('Source: MTA Bus Time vehicle positions');
    expect(html).toMatch(/data \d+ (s|min) old/);
  });
});

describe('the card of an event with a permit', () => {
  const parade = layers.items.find((item) => item.id === 'permitted-events:899286');
  if (parade?.detail.kind !== 'permitted-event') throw new Error('The parade is in the capture');
  const { detail } = parade;
  const now = Date.parse(layers.generatedAt);
  const card = (stretches: typeof detail.stretches) =>
    renderToStaticMarkup(
      createElement(PermittedEventBody, { detail: { ...detail, stretches }, now }),
    );

  it('lists its stretches of today when it has more than one, and none when it has one', () => {
    expect(card(detail.stretches)).not.toContain('Stretches in force today');
    const html = card([
      { startsAt: '2026-11-11T15:00:00.000Z', endsAt: '2026-11-11T17:00:00.000Z' },
      { startsAt: '2026-11-11T19:00:00.000Z', endsAt: '2026-11-11T23:00:00.000Z' },
    ]);
    expect(html).toContain('Stretches in force today');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(cardEs.permitted.stretches).toBe('Tramos vigentes hoy');
  });
});

describe('vehicle position and view labels', () => {
  it('distinguishes an estimated course from a reported course', () => {
    const vehicle = city.vehicles[0];
    if (vehicle === undefined) throw new Error('The capture contains a vehicle');
    const card = (mode: 'bus' | 'subway', basis: 'computed' | 'reported') =>
      renderToStaticMarkup(
        createElement(VehicleCard, {
          vehicle: {
            ...vehicle,
            mode,
            position: { ...vehicle.position, station: null },
            bearing: { degrees: 29, basis },
          },
          source: undefined,
          lost: false,
          now: Date.parse(city.generatedAt),
          onClose: nothing,
        }),
      );
    expect(card('bus', 'computed')).toContain('29°');
    expect(card('bus', 'computed')).toContain('Estimated from successive GPS positions');
    expect(card('subway', 'computed')).toContain('Estimated towards its next stop');
    expect(card('bus', 'reported')).not.toContain('Estimated from successive GPS positions');
  });

  it('names GPS only when the underlying position uses GPS and does not infer loss of signal', () => {
    const vehicle = city.vehicles[0];
    if (vehicle === undefined) throw new Error('The capture contains a vehicle');
    const card = (basis: typeof vehicle.position.basis, lost = false) =>
      renderToStaticMarkup(
        createElement(VehicleCard, {
          vehicle: { ...vehicle, position: { ...vehicle.position, basis, station: null } },
          source: undefined,
          lost,
          now: Date.parse(city.generatedAt),
          onClose: nothing,
        }),
      );
    expect(card('gps')).toContain('ex-card ex-vehicle-card');
    expect(card('gps')).toContain('Last GPS signal');
    expect(card('gps-plus')).toContain('Last GPS signal');
    expect(card('radar')).toContain('Last data');
    expect(card('radar')).not.toContain('Last GPS signal');
    expect(card('scheduled')).toContain('Timetable only position:');
    expect(card('scheduled')).not.toContain('GPS position:');
    expect(card('gps', true)).toContain('no longer in the current view');
    expect(card('gps', true)).not.toContain('no longer reported');
  });
});
