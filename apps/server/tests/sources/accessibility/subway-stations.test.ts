import { describe, expect, it } from 'vitest';

import { mtaSubwayStations } from '../../../src/modules/data-platform/sources/accessibility/subway-stations.js';
import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import { CAPTURED_AT, accepted, capture, text } from '../mta/captures.js';

function parse(body: Uint8Array) {
  return mtaSubwayStations.parse(body, { receivedAt: CAPTURED_AT, previous: undefined });
}

function stations() {
  return mtaSubwayStations.dataSchema.parse(accepted(parse(capture('subway-stations.json'))).data);
}

const row = {
  gtfs_stop_id: '101',
  complex_id: '293',
  stop_name: 'Van Cortlandt Park-242 St',
  ada: '0',
  ada_northbound: '0',
  ada_southbound: '0',
  ada_notes: 'NaN',
};

describe('MTA subway stations and their accessibility', () => {
  it('accepts the capture, dated by its receipt, and stores it unchanged', () => {
    const result = accepted(parse(capture('subway-stations.json')));
    expect(result.dataTime).toEqual(CAPTURED_AT);
    expect(result.coverage).toBe('496 stations: 166 accessible, 8 in one direction');
    expect(mtaSubwayStations.check?.(stations(), undefined)).toEqual([]);
    const stored = mtaSubwayStations.dataSchema.parse(JSON.parse(JSON.stringify(result.data)));
    expect(stored).toEqual(result.data);
  });

  it('names a station by the GTFS id of the subway timetable, one to one', () => {
    const subway = gtfsStaticSources[0]?.parse(capture('gtfs_subway.zip'), {
      receivedAt: CAPTURED_AT,
      previous: undefined,
    });
    if (!subway?.ok) throw new Error('subway capture refused');
    const timetable = Object.entries(subway.data.stops).filter(([, stop]) => stop.station);
    expect(Object.keys(stations().stations).sort()).toEqual(timetable.map(([id]) => id).sort());
  });

  it('keeps the direction of a station accessible one way only, its note and its complex', () => {
    expect(stations().stations['R15']).toEqual({
      name: '49 St',
      complex: '10',
      ada: 'partial',
      northbound: true,
      southbound: false,
      note: 'Uptown only',
    });
    expect(stations().stations['626']?.note).toBe('Uptown local only');
    expect(stations().stations['101']?.note).toBeNull();
    const times = ['127', '725', '902', 'A27', 'R16'].map((id) => stations().stations[id]?.complex);
    expect(new Set(times).size).toBe(1);
  });

  it.each([
    ['not-json', text('<html>503</html>')],
    ['unexpected-shape', text(JSON.stringify([{ ...row, ada: '3' }]))],
    ['check-failed', text(JSON.stringify([row, row]))],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses a list cut below the minimum, asking the dataset without a key', () => {
    const one = accepted(parse(text(JSON.stringify([row]))));
    expect(
      mtaSubwayStations.check?.(mtaSubwayStations.dataSchema.parse(one.data), undefined),
    ).toEqual(['1 stations, minimum 450']);
    const { url } = mtaSubwayStations.request({ credentials: {}, now: CAPTURED_AT });
    expect(url).toMatch(/^https:\/\/data\.ny\.gov\/resource\/39hk-dx4f\.json\?\$select=/);
    expect(url).toContain('complex_id,stop_name,ada,ada_northbound,ada_southbound,ada_notes&');
  });
});
