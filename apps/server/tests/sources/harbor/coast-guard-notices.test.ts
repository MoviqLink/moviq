import { describe, expect, it } from 'vitest';

import {
  coastGuardNotices,
  coastGuardNoticesSchema,
} from '../../../src/modules/data-platform/sources/harbor/coast-guard-notices.js';
import { accepted, capture, storedAndRead, text } from '../regional/captures.js';

const source = coastGuardNotices;
/** Downloaded at 04:00:30 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T04:00:30Z');

function parse(body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

function notices() {
  const result = accepted(parse(capture('harbor', 'uscg-sector-new-york.rss')));
  return coastGuardNoticesSchema.parse(result.data).notices;
}

function feed(items: string): Uint8Array {
  return text(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <title>CG D01 SECTOR NEW YORK</title>${items}</channel></rss>`);
}

const item = (description: string) => `<item>
  <pubDate>Tue, 10 Nov 2026 16:29:02 -0600</pubDate>
  <title>SAFETY/NEWARK BAY/ATON/SEC SNY BNM 0600-26</title>
  <guid isPermaLink="false">1</guid>
  <link>https://content.govdelivery.com/accounts/USDHSCG/bulletins/1</link>
  <description><![CDATA[${description}]]></description>
</item>`;

describe('Coast Guard Sector New York broadcast notices', () => {
  it('accepts the capture, dated by receipt as the feed carries no time of its own', () => {
    const result = accepted(parse(capture('harbor', 'uscg-sector-new-york.rss')));
    expect(source.dataTimeSource).toBe('receipt');
    expect(result.dataTime).toEqual(RECEIVED_AT);
    expect(result.coverage).toBe('25 notices, 5 cancelled by a later one');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
  });

  it('reads the category, the waterway, the subject and the reference of each title', () => {
    expect(notices()[0]).toMatchObject({
      id: '70411649',
      category: 'SAFETY',
      area: 'PEEKSKILL BAY',
      subject: 'ATON',
      reference: 'SEC SNY BNM 0556-26',
      publishedAt: '2026-11-10T22:29:02.000Z',
      link: 'https://content.govdelivery.com/accounts/USDHSCG/bulletins/4326581',
    });
    const byTitle = notices().map((notice) => [notice.category, notice.subject, notice.reference]);
    expect(byTitle).toContainEqual(['CANCELLATION', null, 'SEC SNY BNM 0554-26']);
    expect(byTitle).toContainEqual(['UPDATE', 'HAZARD', 'SEC SNY BNM 0512-26']);
    expect(byTitle).toContainEqual(['SAFETY', 'BRIDGE', 'SEC LIS BNM 0264-26']);
    // A title cut short by the feed names no reference, and no area is made up for it.
    expect(byTitle).toContainEqual(['SCHEDULED', null, null]);
  });

  it('dates the end of each notice: its own CANCEL AT time, or a later cancellation', () => {
    const byReference = new Map(notices().map((notice) => [notice.reference, notice]));
    expect(byReference.get('SEC SNY BNM 0545-26')?.endsAt).toBe('2026-11-01T23:00:00.000Z');
    const bridge = notices().find(
      (notice) => notice.category === 'SAFETY' && notice.reference === 'SEC SNY BNM 0554-26',
    );
    expect(bridge?.cancelledAt).toBe('2026-11-09T21:28:03.000Z');
    expect(byReference.get('SEC SNY BNM 0556-26')).toMatchObject({
      endsAt: null,
      cancelledAt: null,
    });
  });

  it('keeps the notice text but never the point-of-contact line, which names a person', () => {
    const description =
      '<p>1. AID NAME: NEWARK BAY BUOY 1<br />2. POC: BM2 SAILOR (201) 555-0100<br />' +
      '3. NARRATIVE: BUOY 1 OFF STATION &ndash; USE CAUTION.<br />CANCEL AT//150400Z NOV 26//</p>' +
      '<p>BT</p>';
    const [notice] = coastGuardNoticesSchema.parse(
      accepted(parse(feed(item(description)))).data,
    ).notices;
    expect(notice?.text).toBe(
      '1. AID NAME: NEWARK BAY BUOY 1\n3. NARRATIVE: BUOY 1 OFF STATION – USE CAUTION.\n' +
        'CANCEL AT//150400Z NOV 26//',
    );
    expect(notice?.endsAt).toBe('2026-11-15T04:00:00.000Z');
  });

  it('leaves out and counts an item without a readable date', () => {
    const undated = item('<p>1. NARRATIVE: X</p>').replace(/<pubDate>[^<]*/, '<pubDate>soon');
    const result = accepted(parse(feed(item('<p>1. NARRATIVE: Y</p>') + undated)));
    expect(coastGuardNoticesSchema.parse(result.data).leftOut).toBe(1);
  });

  it.each([
    ['not-text', Uint8Array.from([0xff, 0xfe, 0xfd])],
    ['not-xml', text('<rss><channel><item><title>cut')],
    ['unexpected-shape', feed('<item><title>SAFETY/X</title></item>')],
    ['empty-feed', feed('')],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });
});
