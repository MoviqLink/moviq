import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createMerchantApi } from '../../src/features/merchant/api';
import { proposalChanges } from '../../src/features/merchant/model/proposal';
import type { AgentSetup } from '../../src/features/merchant/schemas';
import { MerchantSessionContext } from '../../src/features/merchant/session';
import { merchantEn, merchantEs } from '../../src/features/merchant/texts';
import { AgentTalk } from '../../src/features/merchant/views/AgentTalk';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const day = [{ opens: '11:30', closes: '23:00' }];
const SETUP: AgentSetup = {
  rules: {
    maxDiscountPercent: 25,
    minMarginPercent: 60,
    ordersPerQuarterHour: 4,
    prepMinutes: 15,
    featuredItemIds: ['tr-miso-vegan'],
  },
  version: 3,
  minRewardPercent: 10,
  hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
  menu: [
    {
      id: 'tr-miso-vegan',
      name: 'Vegan miso ramen',
      priceMinor: 1700,
      ingredients: [],
      extras: [],
    },
    { id: 'tr-tonkotsu', name: 'Tonkotsu ramen', priceMinor: 1995, ingredients: [], extras: [] },
  ],
  talk: true,
};

describe('a change the agent proposes (F-J9-14)', () => {
  it('lists only what changes, each from its value to the new one', () => {
    const proposal = {
      rules: { ...SETUP.rules, maxDiscountPercent: 30, featuredItemIds: ['tr-tonkotsu'] },
      hours: { ...SETUP.hours, sun: [] },
    };
    expect(proposalChanges(SETUP, proposal, merchantEn)).toEqual([
      'Maximum discount: 25 % → 30 %',
      'Dishes to offer first: Vegan miso ramen → Tonkotsu ramen',
      'Sunday: 11:30–23:00 → Closed',
    ]);
    expect(proposalChanges(SETUP, SETUP, merchantEs)).toEqual([]);
  });

  it('says the talk needs the AI model when the server has none, and points to the form', () => {
    const session = {
      merchant: {
        id: 'demo-tsuki-ramen-house',
        name: 'Tsuki Ramen House',
        kind: 'restaurant' as const,
        demo: true as const,
        stop: { id: '403671', name: 'East 125th Street', routes: ['M60'] },
        walkMinutes: 2,
        lat: 40.8,
        lon: -73.9,
      },
      expire: () => undefined,
    };
    const html = renderToStaticMarkup(
      createElement(
        MerchantSessionContext.Provider,
        { value: session },
        createElement(AgentTalk, { setup: { ...SETUP, talk: false }, onSaved: () => undefined }),
      ),
    );
    expect(text(html)).toContain(merchantEn.talk.off);
    expect(html).toContain('href="#mc-rule-maxDiscountPercent"');
    expect(html).not.toContain('<textarea');
  });

  it('asks the agent by POST with the language, and reads its proposal', async () => {
    const answer = {
      mode: 'answer',
      reply: 'Tus próximas ofertas pueden llegar al 30 %.',
      proposal: { rules: SETUP.rules, hours: SETUP.hours, version: 3 },
      refused: null,
    };
    const calls: unknown[] = [];
    const merchant = createMerchantApi((path, init) => {
      calls.push([path, init.method, init.body]);
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    });
    expect(await merchant.talk('Sube el descuento al 30 %', 'es')).toEqual(answer);
    expect(calls).toEqual([
      [
        '/api/merchant/agent/talk',
        'POST',
        JSON.stringify({ message: 'Sube el descuento al 30 %', language: 'es' }),
      ],
    ]);
  });
});
