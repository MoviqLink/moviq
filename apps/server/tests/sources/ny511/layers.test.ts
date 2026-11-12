import { describe, expect, it } from 'vitest';

import { ny511Cameras } from '../../../src/modules/data-platform/sources/ny511/cameras.js';
import { ny511CrossingTimes } from '../../../src/modules/data-platform/sources/ny511/crossing-times.js';
import { ny511MessageSigns } from '../../../src/modules/data-platform/sources/ny511/message-signs.js';
import { ny511RoadConditions } from '../../../src/modules/data-platform/sources/ny511/road-conditions.js';
import { RECEIVED, accepted, capture, text } from './captures.js';

describe('511NY winter road conditions', () => {
  const parse = (receivedAt = RECEIVED.roadConditions) =>
    ny511RoadConditions.parse(capture('ny511', 'road-conditions.json'), {
      receivedAt,
      previous: undefined,
    });

  it('keeps NYSDOT words for each segment, including those that report nothing', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('3 segments in the city area, 1 reporting');
    expect(result.data.segments.map((segment) => segment.condition).sort()).toEqual([
      'Generally Clear And Dry',
      'No Active Reporting',
      'Update Pending',
    ]);
    expect(ny511RoadConditions.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(ny511RoadConditions.check?.(result.data, undefined)).toEqual([
      '4 segments statewide, minimum 200',
    ]);
  });
});

describe('511NY message signs', () => {
  const parse = () =>
    ny511MessageSigns.parse(capture('ny511', 'message-signs.json'), {
      receivedAt: RECEIVED.messageSigns,
      previous: undefined,
    });

  it('keeps every page of the signs in the city area, as displayed', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('5 signs in the city area, 1 agencies ahead');
    expect(result.data.signs[0]).toMatchObject({
      id: 'nyRegion11Signs*504',
      road: 'I-278',
      place: 'I-278 W at MP 25.4 (New York City)',
      pages: [
        ['IF CRASH', 'NO INJURIES', 'MINOR DAMAGE'],
        ['MOVE VEHICLES', 'OFF TRAVEL LANES', 'TO EXCHANGE INFO'],
      ],
    });
    expect(ny511MessageSigns.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
  });

  it('shows no time of an agency whose clock is ahead, even its past times', () => {
    const { data } = accepted(parse());
    expect(data.clockAhead).toEqual(['NY Region 11 Signs']);
    const times = (agency: string) =>
      data.signs.filter((sign) => sign.agency === agency).map((sign) => sign.updatedAt);
    expect(times('NY Region 11 Signs')).toEqual([null, null, null]);
    expect(times('NY Signs - Region 10')).toEqual([
      '2026-11-11T04:00:00.000Z',
      '2026-11-11T04:00:08.000Z',
    ]);
  });
});

describe('511NY traffic cameras', () => {
  const parse = () =>
    ny511Cameras.parse(capture('ny511', 'cameras.json'), {
      receivedAt: RECEIVED.cameras,
      previous: undefined,
    });

  it('lists the cameras of the city area with the addresses of their pictures and videos', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('4 cameras in the city area, 1 with video');
    expect(result.data.cameras[0]).toEqual({
      id: '20930',
      name: 'Central Park West @ 86 St',
      road: 'Central Park West @ 86 St',
      owner: 'NYC DOT',
      updatedAt: '2026-10-26T18:16:26.215Z',
      views: [
        {
          name: 'Central Park West @ 86 St',
          kind: 'still',
          url: 'https://nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
          previewUrl: null,
          broken: false,
        },
      ],
      point: [-73.969353, 40.785302],
    });
    const video = result.data.cameras.find((camera) => camera.views[0]?.kind === 'video');
    expect(video?.views[0]?.url).toMatch(/\.m3u8$/);
    expect(video?.views[0]?.previewUrl).toMatch(/\.png$/);
    expect(ny511Cameras.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
  });

  it('refuses a cut list', () => {
    expect(ny511Cameras.check?.(accepted(parse()).data, undefined)).toEqual([
      '6 cameras statewide, minimum 1500',
    ]);
  });
});

describe('Port Authority crossing times', () => {
  const parse = () =>
    ny511CrossingTimes.parse(capture('ny511', 'crossing-times.json'), {
      receivedAt: RECEIVED.crossingTimes,
      previous: undefined,
    });

  it('is dated by the newest crossing time and keeps each approach', () => {
    const result = accepted(parse());
    expect(result.dataTime).toEqual(new Date('2026-11-11T04:26:00Z'));
    expect(result.coverage).toBe('8 crossings, 19 of 30 approaches timed');
    const lincoln = result.data.crossings.find((crossing) => crossing.id === 'lincoln-tunnel');
    expect(lincoln?.approaches.find((approach) => approach.status === 'noReport')).toMatchObject({
      seconds: null,
      updatedAt: null,
    });
    expect(ny511CrossingTimes.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(ny511CrossingTimes.check?.(result.data, undefined)).toEqual([]);
  });

  it('refuses times older than those served, and a layer without crossings', () => {
    const { data } = accepted(parse());
    const served = { ...data, updatedAt: '2026-11-11T05:00:00.000Z' };
    expect(ny511CrossingTimes.check?.(data, served)[0]).toMatch(/^older-than-served/);
    expect(
      ny511CrossingTimes.parse(text('{"features":[]}'), {
        receivedAt: RECEIVED.crossingTimes,
        previous: undefined,
      }),
    ).toMatchObject({
      ok: false,
      code: 'check-failed',
    });
  });
});
