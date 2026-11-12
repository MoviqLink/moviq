import type { AgentPreview, WeeklyHours } from '@moviq/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createMerchantApi } from '../../src/features/merchant/api';
import { checkHours, withStretch } from '../../src/features/merchant/model/hours';
import { merchantEn, merchantEs } from '../../src/features/merchant/texts';
import { AgentHours } from '../../src/features/merchant/views/AgentHours';
import { PreviewCases } from '../../src/features/merchant/views/AgentPreview';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const day = [{ opens: '11:30', closes: '23:00' }];
const HOURS: WeeklyHours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: [] };
const t = merchantEn.hours;

describe('the opening hours of "Your agent" (F-J9-08)', () => {
  it('accepts hours the server would, tidying 9:30 into 09:30 and keeping 24:00', () => {
    const typed = { ...HOURS, sat: [{ opens: '9:30', closes: '24:00' }] };
    expect(checkHours(typed, t)).toEqual({
      ok: true,
      hours: { ...HOURS, sat: [{ opens: '09:30', closes: '24:00' }] },
    });
  });

  it('says which day is wrong and why, before asking the server', () => {
    expect(checkHours({ ...HOURS, mon: [{ opens: '18:00', closes: '09:00' }] }, t)).toEqual({
      ok: false,
      errors: { mon: t.endsBeforeStart },
    });
    const overlapping = [
      { opens: '08:00', closes: '14:00' },
      { opens: '13:00', closes: '20:00' },
    ];
    expect(checkHours({ ...HOURS, fri: overlapping }, t)).toEqual({
      ok: false,
      errors: { fri: t.overlap },
    });
    expect(checkHours({ ...HOURS, tue: [{ opens: 'noon', closes: '20:00' }] }, t)).toEqual({
      ok: false,
      errors: { tue: t.format },
    });
    const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    expect(checkHours(closed, merchantEs.hours)).toEqual({
      ok: false,
      errors: { week: merchantEs.hours.closedAllWeek },
    });
  });

  it('adds a stretch after the last one, up to three, and takes one out', () => {
    const added = withStretch(HOURS, 'mon', 'add');
    expect(added.mon).toEqual([...day, { opens: '23:00', closes: '24:00' }]);
    expect(withStretch(HOURS, 'sun', 'add').sun).toEqual([{ opens: '09:00', closes: '17:00' }]);
    const full = withStretch(withStretch(added, 'mon', 'add'), 'mon', 'add');
    expect(full.mon).toHaveLength(3);
    expect(withStretch(added, 'mon', 0).mon).toEqual([{ opens: '23:00', closes: '24:00' }]);
  });

  it('draws every day with its stretches on a line of 24 hours, closed days said', () => {
    const html = renderToStaticMarkup(
      createElement(AgentHours, { form: HOURS, errors: {}, onChange: () => undefined }),
    );
    expect(html.match(/class="mc-hours-day"/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Monday, stretch 1, opens"');
    expect(html).toContain('left:47.91666666666667%');
    expect(text(html)).toContain('Sunday Closed');
  });
});

const PREVIEW: AgentPreview = {
  composer: 'rules',
  composedAt: '2026-11-11T23:00:00.000Z',
  cases: [
    {
      example: 'allergies',
      alias: 'Ana',
      craving: 'ramen',
      preferences: {
        allergies: ['peanuts'],
        avoid: ['scallions'],
        noAlcohol: false,
        diet: 'any',
        drink: null,
      },
      outcome: {
        kind: 'accepted',
        lines: [{ name: 'Vegan miso ramen', quantity: 1, changes: 'without scallions' }],
        note: 'Made for you.',
        pickupAt: '2026-11-11T23:15:00.000Z',
        reward: {
          listPrice: { amountMinor: 1700, currency: 'USD' },
          price: { amountMinor: 1445, currency: 'USD' },
          earned: { amountMinor: 255, currency: 'USD' },
          percent: 15,
        },
      },
    },
    {
      example: 'vegetarian',
      alias: 'Leo',
      craving: 'ramen',
      preferences: { allergies: [], avoid: [], noAlcohol: true, diet: 'vegetarian', drink: null },
      outcome: {
        kind: 'rejected',
        lines: [{ name: 'Vegan miso ramen', quantity: 1, changes: '' }],
        note: 'Made for you.',
        pickupAt: '2026-11-11T23:15:00.000Z',
        refusals: [{ reason: 'closed', message: 'The merchant is closed at that time.' }],
      },
    },
    {
      example: 'no-preferences',
      alias: 'Mia',
      craving: 'ramen',
      preferences: { allergies: [], avoid: [], noAlcohol: false, diet: 'any', drink: null },
      outcome: { kind: 'nothing' },
    },
  ],
};

describe('the preview of "Your agent" (F-J9-09)', () => {
  it('shows each example customer with the offer, the check and the reward', () => {
    const shown = text(renderToStaticMarkup(createElement(PreviewCases, { preview: PREVIEW })));
    for (const part of [
      'Ana example',
      'Allergic to peanuts · Without scallions',
      'Vegan miso ramen · without scallions',
      'The server would accept it',
      '$14.45',
      '15 % reward',
      'The server would reject it: you are closed at that time',
      'Your rules leave nothing to offer this customer.',
      'Composed at 6:00 PM',
    ]) {
      expect(shown).toContain(part);
    }
  });

  it('reads the preview and a refused scan, with its reason, as answers', async () => {
    const calls: string[] = [];
    const refusal = {
      error: {
        code: 'forbidden',
        message: 'Another merchant.',
        requestId: 'r',
        reason: 'other-merchant',
      },
    };
    const merchant = createMerchantApi((path, init) => {
      calls.push(`${init.method ?? 'GET'} ${path}`);
      const answer = path.endsWith('/preview') ? [200, PREVIEW] : [403, refusal];
      return Promise.resolve(
        new Response(JSON.stringify(answer[1]), { status: Number(answer[0]) }),
      );
    });
    expect(await merchant.preview(new AbortController().signal)).toEqual(PREVIEW);
    expect(await merchant.scan('mq1.code')).toEqual(refusal);
    expect(calls).toEqual(['GET /api/merchant/agent/preview', 'POST /api/merchant/scan']);
  });
});
