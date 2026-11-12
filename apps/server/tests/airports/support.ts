import { toInstant, type Provenance } from '@moviq/contracts';

import type { AirportSnapshot } from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import { readSnapshot } from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import type {
  AirportBoards,
  BoardReading,
} from '../../src/modules/data-platform/on-demand/airport-boards.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import type { SourceReader, SourceReading } from '../../src/modules/data-platform/reader.js';
import {
  parseAirTraffic,
  type AirTraffic,
} from '../../src/modules/data-platform/sources/air/aircraft.js';
import { capture } from '../on-demand/support.js';

/** When RapidAPI answered the JFK board (`aerodatabox-fids-kjfk.headers.txt`). */
export const BOARD_TAKEN_AT = new Date('2026-11-11T05:39:49Z');
/** When adsb.lol built the answer in `adsb-lol-new-york-fids.json` (`now`). */
export const ADSB_AT = new Date(1794375800004);

/**
 * The JFK board written for the tests in AeroDataBox's shape (`aerodatabox-fids-kjfk.json`), read
 * as the provider reads it.
 */
export function jfkSnapshot(): AirportSnapshot {
  const outcome = readSnapshot(
    {
      status: 200,
      body: new TextEncoder().encode(capture('aerodatabox-fids-kjfk.json')),
      receivedAt: BOARD_TAKEN_AT,
    },
    'JFK',
  );
  if (!outcome.ok) throw new Error(outcome.detail);
  return outcome.value;
}

/** The real ADS-B answer around New York taken 3.5 minutes after the board. */
export function jfkTraffic(): AirTraffic {
  const parsed = parseAirTraffic(
    new TextEncoder().encode(capture('adsb-lol-new-york-fids.json')),
    ADSB_AT,
    { list: 'ac', nowUnit: 'ms' },
  );
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.data;
}

/**
 * Usual routes adsbdb gave for three call signs on 11/11/2026 (audit of the flight sources,
 * `evidencias/adsbdb-*`): THY12 JFK–Istanbul, JBU1024 Fort Lauderdale–JFK, AAL2077 Boston–Dallas.
 */
export const USUAL_ROUTES: Readonly<Record<string, readonly string[]>> = {
  THY12: ['KJFK', 'LTFM'],
  JBU1024: ['KFLL', 'KJFK'],
  AAL2077: ['KBOS', 'KDFW'],
};

export function provenance(sourceId: string, at: Date, state: Provenance['state'] = 'healthy') {
  return {
    sourceId,
    dataTime: toInstant(at),
    receivedAt: toInstant(at),
    ageSeconds: 0,
    state,
    evidence: `Test reading of ${sourceId}.`,
  } satisfies Provenance;
}

/**
 * A reader serving test data by source id, validated by each definition's own schema; a source
 * without data reads as unavailable.
 */
export function fakeReader(
  data: Readonly<Record<string, unknown>>,
  at: Date,
  states: Readonly<Record<string, Provenance['state']>> = {},
): SourceReader {
  return {
    read<T>(definition: SourceDefinition<T>): Promise<SourceReading<T>> {
      const stored = data[definition.id];
      if (stored === undefined) {
        return Promise.resolve({
          data: undefined,
          provenance: { ...provenance(definition.id, at, 'unavailable'), dataTime: null },
        });
      }
      return Promise.resolve({
        data: definition.dataSchema.parse(stored),
        version: '1',
        provenance: provenance(definition.id, at, states[definition.id]),
      });
    },
  };
}

/** Boards that answer the given readings and count what is asked. */
export function stubBoards(readings: Partial<Record<string, BoardReading>>, at: Date) {
  const asked: string[] = [];
  const boards: AirportBoards = {
    read(code) {
      asked.push(code);
      return Promise.resolve(
        readings[code] ?? {
          state: 'none',
          snapshot: null,
          provenance: { ...provenance('aerodatabox', at, 'unavailable'), dataTime: null },
          nextRefreshAt: null,
        },
      );
    },
  };
  return { boards, asked };
}

export function currentReading(snapshot: AirportSnapshot): BoardReading {
  return {
    state: 'current',
    snapshot,
    provenance: provenance('aerodatabox', snapshot.takenAt),
    nextRefreshAt: new Date(snapshot.takenAt.getTime() + 3 * 60 * 60_000),
  };
}
