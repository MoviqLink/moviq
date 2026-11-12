import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  faaAirportStatusSource,
  type NewYorkAirportStatus,
} from '../../../src/modules/data-platform/sources/city/faa-airport-status.js';
import {
  durationMinutes,
  parseUpdateTime,
  tagBalanceProblem,
} from '../../../src/modules/data-platform/sources/city/faa-nas-status-xml.js';

const source = faaAirportStatusSource;
const capture = readFileSync(
  fileURLToPath(
    new URL('../../../../../tests/fixtures/city/faa-airport-status.xml', import.meta.url),
  ),
  'utf8',
);
/** Downloaded at 01:00:57 UTC on 11/11/2026. */
const receivedAt = new Date('2026-11-11T01:00:57Z');

function parse(text: string, previous?: NewYorkAirportStatus) {
  return source.parse(new TextEncoder().encode(text), { receivedAt, previous });
}

/** A document built from the element names of the live feed, for the programs absent today. */
function constructed(delayTypes: string): string {
  return (
    '<AIRPORT_STATUS_INFORMATION><Update_Time>Wed Nov 11 01:00:34 2026 GMT</Update_Time>' +
    `${delayTypes}</AIRPORT_STATUS_INFORMATION>`
  );
}

const programs = constructed(
  '<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>' +
    '<Program><ARPT>JFK</ARPT><Reason>thunderstorms</Reason><End_Time>7:45 pm EST</End_Time></Program>' +
    '<Program><ARPT>BOS</ARPT><Reason>wind</Reason><End_Time>8:00 pm EST</End_Time></Program>' +
    '</Ground_Stop_List></Delay_type>' +
    '<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay>' +
    '<ARPT>EWR</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 3 minutes</Avg>' +
    '<Max>2 hours and 1 minute</Max></Ground_Delay></Ground_Delay_List></Delay_type>' +
    '<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>' +
    '<Delay><ARPT>LGA</ARPT><Reason>VOL:Multi-taxi</Reason><Arrival_Departure Type="Departure">' +
    '<Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure>' +
    '</Delay></Arrival_Departure_Delay_List></Delay_type>',
);

describe('FAA airport status', () => {
  it('accepts the real capture as three airports with no active programs', () => {
    const result = parse(capture);
    expect(result).toMatchObject({
      ok: true,
      dataTime: new Date('2026-11-11T01:00:34Z'),
      coverage: '3 airports, no active programs',
    });
    if (!result.ok) return;
    expect(result.data.airports).toEqual([
      { code: 'JFK', programs: [] },
      { code: 'LGA', programs: [] },
      { code: 'EWR', programs: [] },
    ]);
  });

  it('keeps the parsed data through JSON storage and its schema', () => {
    for (const text of [capture, programs]) {
      const result = parse(text);
      if (!result.ok) throw new Error(result.detail);
      const stored: unknown = JSON.parse(JSON.stringify(result.data));
      expect(source.dataSchema.parse(stored)).toEqual(result.data);
    }
  });

  it('normalises ground stops, ground delays and delays of New York only', () => {
    const result = parse(programs);
    if (!result.ok) throw new Error(result.detail);
    expect(result.coverage).toBe('3 airports, 3 active programs');
    expect(result.data.airports).toEqual([
      {
        code: 'JFK',
        programs: [{ kind: 'ground-stop', reason: 'thunderstorms', until: '7:45 pm EST' }],
      },
      {
        code: 'LGA',
        programs: [
          {
            kind: 'delay',
            direction: 'departure',
            reason: 'VOL:Multi-taxi',
            minimum: { text: '16 minutes', minutes: 16 },
            maximum: { text: '30 minutes', minutes: 30 },
            trend: 'Increasing',
          },
        ],
      },
      {
        code: 'EWR',
        programs: [
          {
            kind: 'ground-delay',
            reason: 'low ceilings',
            average: { text: '1 hour and 3 minutes', minutes: 63 },
            maximum: { text: '2 hours and 1 minute', minutes: 121 },
          },
        ],
      },
    ]);
  });

  it('normalises a closure with its period as the FAA writes it', () => {
    const closure = capture.replace('<ARPT>SNA</ARPT>', '<ARPT>LGA</ARPT>');
    const result = parse(closure);
    if (!result.ok) throw new Error(result.detail);
    expect(result.data.airports[1]?.programs).toEqual([
      {
        kind: 'closure',
        reason: '!SNA 11/008 SNA AD AP CLSD DLY 0730-1415 2611100730-2611211415',
        from: 'Nov 10 at 07:30 UTC.',
        reopens: 'Nov 21 at 14:15 UTC.',
      },
    ]);
  });

  describe('refuses each failure of its catalogue with its code', () => {
    const refusals: readonly (readonly [string, string])[] = [
      ['not-xml', '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'],
      ['not-xml', capture.slice(0, capture.indexOf('<Delay_type>', 200))],
      ['not-xml', '{"error":"maintenance"}'],
      ['unexpected-shape', '<html><body>Down for maintenance</body></html>'],
      ['bad-update-time', capture.replace('Wed Nov 11 01:00:34 2026 GMT', '11/11/2026 01:00')],
      [
        'unknown-program-type',
        constructed(
          '<Delay_type><Name>Deicing</Name><Deicing_List><Deicing><ARPT>LGA</ARPT></Deicing>' +
            '</Deicing_List></Delay_type>',
        ),
      ],
    ];
    it.each(refusals)('%s', (code, text) => {
      expect(parse(text)).toMatchObject({ ok: false, code });
    });

    it('older-than-served', () => {
      const result = parse(capture);
      if (!result.ok) throw new Error(result.detail);
      const served = { ...result.data, updatedAt: '2026-11-11T01:05:00.000Z' };
      expect(source.check?.(result.data, served)).toEqual([
        expect.stringMatching(/^older-than-served: /),
      ]);
      expect(source.check?.(result.data, result.data)).toEqual([]);
    });

    it('covers every code of the catalogue', () => {
      expect(source.failures.map((failure) => failure.code).sort()).toEqual(
        [...new Set(refusals.map(([code]) => code)), 'older-than-served'].sort(),
      );
    });
  });

  it('finds tags left open, crossed or outside a single root', () => {
    expect(tagBalanceProblem(capture)).toBeUndefined();
    expect(tagBalanceProblem('<?xml version="1.0"?><!-- note --><a><b/><c x="1">t</c></a>')).toBe(
      undefined,
    );
    expect(tagBalanceProblem('<a><b></a>')).toBe('</a> closes <b>');
    expect(tagBalanceProblem('<a>open')).toBe('<a> is never closed');
    expect(tagBalanceProblem('<a></a><b></b>')).toBe('2 root elements');
    expect(tagBalanceProblem('plain text')).toBe('0 root elements');
  });

  it('reads the times and durations in the forms the FAA writes', () => {
    expect(parseUpdateTime('Tue Nov  3 09:05:00 2026 GMT')).toEqual(
      new Date('2026-11-03T09:05:00Z'),
    );
    expect(parseUpdateTime('Mon Feb 30 09:05:00 2026 GMT')).toBeUndefined();
    expect(durationMinutes('45 minutes')).toBe(45);
    expect(durationMinutes('1 hour')).toBe(60);
    expect(durationMinutes('about an hour')).toBeUndefined();
  });

  it('asks the NAS Status API for XML', () => {
    expect(source.request({ credentials: {}, now: receivedAt })).toEqual({
      url: 'https://nasstatus.faa.gov/api/airport-status-information',
      headers: { accept: 'application/xml' },
    });
  });
});
