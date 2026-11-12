import { flightSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { Secret } from '../../src/config/secret.js';
import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import {
  AERODATABOX_HOST,
  aeroDataBoxCredential,
  createAeroDataBoxFlights,
  flightUrl,
  type AeroDataBoxCredential,
} from '../../src/modules/data-platform/on-demand/aerodatabox.js';
import { createUnitAllowance } from '../../src/modules/data-platform/on-demand/aerodatabox-units.js';
import type { FlightQuery } from '../../src/modules/journeys/ports.js';
import { capture, fixedClock, stubHttp, type StubAnswer } from './support.js';

interface SchemaNode {
  readonly type?: string;
  readonly nullable?: boolean;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly allOf?: readonly { readonly $ref: string }[];
  readonly $ref?: string;
}

interface Spec {
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Readonly<
    Record<
      string,
      {
        readonly get: {
          readonly parameters: readonly { readonly name: string }[];
          readonly responses: Readonly<Record<string, unknown>>;
        };
      }
    >
  >;
  readonly components: {
    readonly schemas: Readonly<Record<string, SchemaNode>>;
    readonly securitySchemes: Readonly<Record<string, { readonly name: string }>>;
  };
}

/** The official OpenAPI, cut to the operation and schemas read (see the fixtures README). */
const spec = JSON.parse(capture('aerodatabox-openapi-flight-status.json')) as Spec;
const operation = spec.paths['/flights/{searchBy}/{searchParam}/{dateLocal}']?.get;

function schema(name: string): SchemaNode {
  const found = spec.components.schemas[name];
  if (found === undefined) throw new Error(`${name} is not in the official schema`);
  return found;
}

/** A property of a schema, following `allOf` and `$ref` to the schema it points to. */
function property(owner: SchemaNode, name: string): { node: SchemaNode; target: SchemaNode } {
  const node = owner.properties?.[name];
  if (node === undefined) throw new Error(`${name} is not a documented property`);
  const ref = node.$ref ?? node.allOf?.[0]?.$ref;
  const target = ref === undefined ? node : schema(ref.replace('#/components/schemas/', ''));
  return { node, target };
}

/**
 * A `FlightContract` with every required field of the official schema and the optional ones the
 * reader uses. AeroDataBox publishes no example, so the values are test values, not a capture.
 */
function documentedFlight(departure: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    number: 'AA 100',
    status: 'Expected',
    codeshareStatus: 'IsOperator',
    isCargo: false,
    lastUpdatedUtc: '2026-11-11 01:50Z',
    departure: {
      airport: { iata: 'JFK', name: 'New York John F Kennedy' },
      scheduledTime: { utc: '2026-11-11 23:00Z', local: '2026-11-11 18:00-05:00' },
      terminal: '8',
      quality: ['Basic'],
      ...departure,
    },
    arrival: { airport: { iata: 'LHR', name: 'London Heathrow' }, quality: ['Basic'] },
    ...extra,
  };
}

const query: FlightQuery = { carrier: 'AA', number: '100', date: '2026-11-11' };
const clock = fixedClock('2026-11-11T02:00:00Z');
const keyed: AeroDataBoxCredential = { key: new Secret('test-key') };

async function find(answer: StubAnswer, credential: AeroDataBoxCredential = keyed, at = query) {
  const { http, sent } = stubHttp(answer);
  const units = createUnitAllowance();
  const flights = createAeroDataBoxFlights({ http, clock, credential, units, spacingMs: 0 });
  const outcome = await flights.find(at);
  return { outcome, sent };
}

const json = (value: unknown): StubAnswer => ({ body: JSON.stringify(value) });

describe('AeroDataBox flights', () => {
  it('reads only fields the official schema documents, as it documents them', () => {
    const flight = schema('FlightContract');
    expect(flight.required).toEqual(
      expect.arrayContaining(['number', 'status', 'isCargo', 'lastUpdatedUtc', 'departure']),
    );
    expect(property(flight, 'isCargo').node.type).toBe('boolean');
    expect(property(flight, 'lastUpdatedUtc').node.type).toBe('string');
    expect(property(flight, 'status').target.enum).toContain('Unknown');
    const movement = property(flight, 'departure').target;
    expect(property(movement, 'terminal').node).toMatchObject({ type: 'string', nullable: true });
    const airport = property(movement, 'airport').target;
    expect(airport.required).toContain('name');
    expect(property(airport, 'iata').node).toMatchObject({ type: 'string', nullable: true });
    const time = property(movement, 'scheduledTime').target;
    expect(time.required).toEqual(expect.arrayContaining(['utc', 'local']));
    expect(movement.required).not.toContain('scheduledTime');
    for (const name of ['revisedTime', 'predictedTime', 'runwayTime']) {
      expect(property(movement, name).target).toBe(time);
      expect(movement.required).not.toContain(name);
    }
    expect(property(movement, 'gate').node).toMatchObject({ type: 'string', nullable: true });
    expect(property(flight, 'callSign').node).toMatchObject({ type: 'string', nullable: true });
    expect(property(flight, 'status').target.enum).toEqual(
      expect.arrayContaining(['Expected', 'Departed', 'EnRoute']),
    );
  });

  it('reads the gate, and the time predicted from history only without a revised one', async () => {
    const predicted = { utc: '2026-11-11 23:40Z', local: '2026-11-11 18:40-05:00' };
    const { outcome } = await find(
      json([documentedFlight({ predictedTime: predicted, gate: ' B 12 ' })]),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        revisedDeparture: { at: '2026-11-11T23:40:00.000Z', kind: 'predicted' },
        gate: 'B 12',
        callSign: null,
      },
    });
  });

  it('asks the documented operation through the RapidAPI gateway', async () => {
    expect(spec.servers[0]?.url).toBe(`https://${AERODATABOX_HOST}/`);
    expect(Object.keys(operation?.responses ?? {})).toContain('204');
    expect(operation?.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining([
        'dateLocalRole',
        'withAircraftImage',
        'withLocation',
        'withFlightPlan',
      ]),
    );
    const { sent } = await find(json([documentedFlight({})]));
    expect(sent[0]?.url).toBe(flightUrl(query));
    expect(flightUrl(query)).toBe(
      'https://aerodatabox.p.rapidapi.com/flights/number/AA100/2026-11-11?dateLocalRole=Departure' +
        '&withAircraftImage=false&withLocation=false&withFlightPlan=false',
    );
    const headerNames = Object.values(spec.components.securitySchemes).map((s) => s.name);
    expect(headerNames).toEqual(['X-RapidAPI-Key', 'X-RapidAPI-Host']);
    expect(sent[0]?.headers.get('x-rapidapi-key')).toBe('test-key');
    expect(sent[0]?.headers.get('x-rapidapi-host')).toBe(AERODATABOX_HOST);
    expect(sent[0]?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
  });

  it('normalises the flight departing New York, and keeps it through JSON', async () => {
    const { outcome } = await find(
      json([
        documentedFlight({
          airport: { iata: 'BOS', name: 'Boston Logan' },
          scheduledTime: { utc: '2026-11-11T13:00:00Z', local: '2026-11-11T08:00:00-05:00' },
        }),
        documentedFlight({}),
      ]),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        carrier: 'AA',
        number: '100',
        departureAt: '2026-11-11T23:00:00.000Z',
        airport: 'JFK',
        terminal: '8',
        status: 'Expected',
        provenance: {
          sourceId: 'aerodatabox',
          dataTime: '2026-11-11T01:50:00.000Z',
          receivedAt: '2026-11-11T02:00:00.000Z',
          ageSeconds: 600,
          state: 'healthy',
          evidence: 'AeroDataBox lists AA 100 departing JFK on 2026-11-11.',
        },
      },
    });
    if (!outcome.ok || outcome.value === null) throw new Error('expected a flight');
    expect(outcome.provenance).toEqual(outcome.value.provenance);
    expect(flightSchema.parse(JSON.parse(JSON.stringify(outcome.value)))).toEqual(outcome.value);
  });

  it('answers "no such flight" for a 204, another airport, another day or a cargo flight', async () => {
    const answers: readonly StubAnswer[] = [
      { status: 204 },
      json([documentedFlight({ airport: { iata: 'BOS', name: 'Boston Logan' } })]),
      json([
        documentedFlight({
          scheduledTime: { utc: '2026-11-13 04:00Z', local: '2026-11-12 23:00-05:00' },
        }),
      ]),
      json([documentedFlight({}, { isCargo: true })]),
      json([]),
    ];
    for (const answer of answers) {
      const { outcome } = await find(answer);
      expect(outcome).toMatchObject({ ok: true, value: null, provenance: { dataTime: null } });
    }
  });

  it('reads an unknown status as none and an empty terminal as none', async () => {
    const { outcome } = await find(
      json([documentedFlight({ terminal: ' ' }, { status: 'Unknown' })]),
    );
    expect(outcome).toMatchObject({ ok: true, value: { status: null, terminal: null } });
  });

  describe('gives each known failure its code', () => {
    it('missing-credential, without any request', async () => {
      const { outcome, sent } = await find(json([]), { missing: ['AERODATABOX_KEY'] });
      expect(outcome).toEqual({
        ok: false,
        state: 'misconfigured',
        code: 'missing-credential',
        detail: 'Set AERODATABOX_KEY to look up flights.',
      });
      expect(sent).toEqual([]);
    });

    const failures: readonly (readonly [string, string, StubAnswer])[] = [
      ['access-refused', 'misconfigured', { status: 401, body: '{"message":"Invalid key"}' }],
      ['rate-limited', 'rate_limited', { status: 429, headers: { 'retry-after': '1' } }],
      ['provider-error', 'unavailable', { status: 503 }],
      ['not-json', 'unavailable', { body: '<html>Gateway</html>' }],
      ['unexpected-shape', 'misconfigured', json({ message: 'flights' })],
      ['no-departure-time', 'unavailable', json([documentedFlight({ scheduledTime: null })])],
    ];
    it.each(failures)('%s', async (code, state, answer) => {
      const { outcome } = await find(answer);
      expect(outcome).toMatchObject({ ok: false, code, state });
    });

    it('bad-query, without any request', async () => {
      const { outcome, sent } = await find(json([]), keyed, { ...query, number: 'AA100' });
      expect(outcome).toMatchObject({ ok: false, code: 'bad-query' });
      expect(sent).toEqual([]);
    });
  });

  it('takes its key from the configured integration only', () => {
    expect(aeroDataBoxCredential(resolveIntegrations({}))).toEqual({
      missing: ['AERODATABOX_KEY'],
    });
    const configured = aeroDataBoxCredential(resolveIntegrations({ AERODATABOX_KEY: ' k ' }));
    expect('key' in configured && configured.key.reveal()).toBe('k');
  });
});
