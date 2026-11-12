import type { CityGroup, CityLayerId, CityLayerStatus } from '@moviq/contracts';

const s = String;

// The city layers' words. Spanish has exactly the same keys: TypeScript and the tests check it.
export const cityEn = {
  groups: {
    transport: 'Transport',
    street: 'Street',
    places: 'Useful places',
    harbor: 'Harbor',
    weather: 'Weather',
  } satisfies Record<CityGroup, string>,
  layersOn: (on: number, all: number) => `${s(on)} of ${s(all)} on`,
  layers: {
    'transit-alerts': 'Transit alerts',
    incidents: 'Incidents',
    closures: 'Closures',
    construction: 'Roadworks',
    'street-permits': 'Street permits',
    'permitted-events': 'Permitted events today',
    cameras: 'Traffic cameras',
    chargers: 'EV chargers',
    defibrillators: 'Defibrillators',
    restrooms: 'Public restrooms',
    landmarks: 'Designated landmarks',
    'subway-entrances': 'Subway entrances',
    'parking-meters': 'Parking meters',
    'parking-signs': 'Parking signs',
    'vessel-calls': 'Ship calls at Port Newark',
    'harbor-conditions': 'Harbor conditions',
    'coast-guard': 'Coast Guard notices',
    'road-conditions': 'Road surface',
    'weather-alerts': 'Weather alerts',
  } satisfies Record<CityLayerId, string>,
  marks: {
    'street-permits': 'A permit: not proof of works or of a closure',
    'permitted-events': 'Placed in words by each permit, so listed here',
    chargers: 'As listed: never free or in use',
    defibrillators: 'Registered units; no opening hours published',
    restrooms: 'Free and in service; hours as published',
    'subway-entrances': '2024 survey',
    'parking-meters': '“Active” is the meter, not a free space',
    'parking-signs': 'Sign text as posted, never “allowed now”',
    'vessel-calls': 'Listed by the terminal, without a berth on the map',
    'coast-guard': 'Placed in words by each notice, so listed here',
  } satisfies Partial<Record<CityLayerId, string>>,
  show: (layer: string) => `Show ${layer}`,
  status: {
    live: 'Up to date',
    degraded: 'Partly out of date',
    unavailable: 'No data now',
  } satisfies Record<CityLayerStatus, string>,
  age: (age: string) => `${age} ago`,
  inForce: (day: string) => `in force, published on ${day}`,
  noDataCount: 'no data',
  leftOut: (n: number) => `${s(n)} left out, incomplete at the source`,
  loading: 'Reading this layer…',
  zoomIn: 'Zoom in to a few streets to see them.',
  capped: (n: string) => `${n} in this area: zoom in to see them.`,
  noneHere: 'None in this area.',
  more: (n: number) => `and ${s(n)} more`,
  /** In force since another day: listed until it ends, at a time today or on a later day. */
  untilTime: (time: string) => `until ${time}`,
  untilDay: (day: string) => `until ${day}`,
  byBorough: 'In force today, by borough',
  unplacedPermits: 'Published by street name, without a place: MovIQ does not draw them.',
  failed: 'The city layers did not load. We try again on our own.',
  signsAsk: 'Asked area by area once the map is close',
  radar: {
    name: 'Weather radar',
    mark: 'NOAA radar mosaic · public domain · asked every 2 min',
    asked: (time: string) => `Asked at ${time}`,
  },
};

export type CityDict = typeof cityEn;
