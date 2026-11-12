import { cityLayersResponseSchema, liveVehiclesResponseSchema } from '@moviq/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DestinationPanel,
  type Destination,
} from '../../src/features/explore/destinations/DestinationPanel';
import { CityItems } from '../../src/features/explore/destinations/CityItems';
import cityFixture from './fixtures/city-layers.json';
import liveFixture from './fixtures/live-city.json';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
});
const cityData = cityLayersResponseSchema.parse(cityFixture);
const liveData = liveVehiclesResponseSchema.parse(liveFixture);
const noop = () => undefined;
function view(destination: Destination, failing = false) {
  return renderToStaticMarkup(
    createElement(DestinationPanel, {
      destination,
      live: { data: liveData, receivedAt: 1, failing, retryNow: noop },
      stations: liveData.stations,
      vehicles: liveData.vehicles,
      city: {
        on: new Set(cityData.asked),
        toggle: noop,
        data: cityData,
        failing,
        signs: null,
        items: cityData.items,
        drawn: [],
      },
      events: {
        on: true,
        range: 'today',
        category: null,
        data: null,
        failing: false,
        toggle: noop,
        setRange: noop,
        setCategory: noop,
      },
      onOpen: noop,
    }),
  );
}
describe('focused destinations', () => {
  it('shows distinct headings and relevant source-backed incidents rather than cameras', () => {
    const html = view('incidents');
    expect(html).toContain('<h1>Incidents</h1>');
    expect(html).toContain('Brooklyn Bridge eastbound: Disabled vehicle.');
    expect(html).not.toContain('Central Park West @ 86 St');
    expect(html).toContain('511NY traffic incidents');
    expect(html).toContain('Up to date');
  });
  it('does not turn an unavailable incident source into an empty claim', () => {
    const data = cityLayersResponseSchema.parse({
      ...cityData,
      asked: ['incidents'],
      layers: cityData.layers.map((row) =>
        row.layer === 'incidents' ? { ...row, status: 'unavailable' as const } : row,
      ),
      items: [],
    });
    const html = renderToStaticMarkup(
      createElement(CityItems, {
        city: {
          on: new Set(data.asked),
          toggle: noop,
          data,
          failing: false,
          signs: null,
          items: [],
          drawn: [],
        },
        layers: ['incidents'],
        query: '',
        onOpen: noop,
      }),
    );
    expect(html).toContain(
      'Source unavailable; absence of data does not mean there are no incidents.',
    );
    expect(html).not.toContain('No matching items in this map area.');
  });

  it('does not claim an empty list when a source is degraded', () => {
    const data = cityLayersResponseSchema.parse({
      ...cityData,
      asked: ['incidents'],
      layers: cityData.layers.map((row) =>
        row.layer === 'incidents' ? { ...row, status: 'degraded' } : row,
      ),
      items: [],
    });
    const html = renderToStaticMarkup(
      createElement(CityItems, {
        city: {
          on: new Set(data.asked),
          toggle: noop,
          data,
          failing: false,
          signs: null,
          items: [],
          drawn: [],
        },
        layers: ['incidents'],
        query: '',
        onOpen: noop,
      }),
    );
    expect(html).toContain('Some source data is incomplete or out of date');
    expect(html).not.toContain('No matching items in this map area.');
  });

  it('shows cameras and closures in traffic and keeps source failure visible', () => {
    const html = view('traffic', true);
    expect(html).toContain('<h1>Traffic</h1>');
    expect(html).toContain('Traffic cameras');
    expect(html).toContain('The latest update failed');
    expect(html).not.toContain('No matching items in this map area.');
  });
  it('provides a station search and does not claim observed lines are a complete directory', () => {
    const html = view('stations');
    expect(html).toContain('<h1>Stations and lines</h1>');
    expect(html).toContain('not a complete directory');
    expect(html).toContain('type="search"');
    expect(html).toContain('Stations and entrances');
  });
  it('shows tourist events and explains limitations without a false landmarks list', () => {
    const html = view('tourist');
    expect(html).toContain('<h1>Tourist mode</h1>');
    expect(html).toContain('Tourist experiences are not available here yet.');
    expect(html).toContain('Show events on the map');
    expect(html).toContain('Reading the sources');
  });
});
