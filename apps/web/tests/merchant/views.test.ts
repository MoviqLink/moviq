import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Conversation } from '../../src/features/merchant/ui/Conversation';
import { OfferSummary } from '../../src/features/merchant/ui/OfferSummary';
import { ProblemNote } from '../../src/features/merchant/ui/ProblemNote';
import { ToDeduct } from '../../src/features/merchant/ui/ToDeduct';
import { CONVERSATION } from './conversation';

// The panel is rendered in English whatever the language of the machine running the tests.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('merchant panel views', () => {
  it('draw the conversation as one labelled list, Sara and the agent apart, the server on the line', () => {
    const html = renderToStaticMarkup(
      createElement(Conversation, { alias: 'Mia', entries: CONVERSATION, dishes: new Map() }),
    );
    expect(html).toContain('aria-label="Conversation between Sara and your agent about Mia"');
    expect(html.match(/<li class="mc-step /g)).toHaveLength(CONVERSATION.length);
    expect(html).toContain('mc-step mc-from-sara mc-tone-plain');
    expect(html).toContain('mc-step mc-from-merchant-agent mc-tone-plain');
    expect(html).toContain('mc-step mc-from-server mc-tone-rejected');
    expect(text(html)).toContain('Rejected: goes over your agent’s maximum discount');
    expect(html).toContain('<q class="mc-step-quote" lang="en">The discount is above 5%.</q>');
  });

  it('show the offer with the amounts the server set', () => {
    const offer = {
      id: 'offer-1',
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
      lines: [{ name: 'Tonkotsu ramen', quantity: 1, changes: 'without scallions' }],
      reward: {
        listPrice: { amountMinor: 1995, currency: 'USD' as const },
        price: { amountMinor: 1696, currency: 'USD' as const },
        earned: { amountMinor: 299, currency: 'USD' as const },
        percent: 14,
      },
      pickupAt: '2026-11-11T16:20:00.000Z',
      detourMinutes: 4,
      note: 'Made for you.',
      composer: 'rules' as const,
      recommended: true,
      status: 'reserved' as const,
      expiresAt: '2026-11-11T16:30:00.000Z',
    };
    const shown = text(renderToStaticMarkup(createElement(OfferSummary, { offer })));
    for (const part of [
      'Tonkotsu ramen · without scallions',
      '$19.95',
      '$16.96',
      '$2.99 · 14 %',
      '11:20 AM',
      'Reserved',
      'Composed from your rules',
    ]) {
      expect(shown).toContain(part);
    }
    expect(text(renderToStaticMarkup(createElement(OfferSummary, { offer: null })))).toContain(
      'No offer passed the server’s checks.',
    );
  });

  it('tell a problem with what to do, and nothing when all is well', () => {
    const failure = { kind: 'network', timedOut: false } as const;
    const html = renderToStaticMarkup(
      createElement(ProblemNote, { failure, onRetry: () => undefined }),
    );
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(
      'MovIQ’s server did not answer. Check the connection and try again.',
    );
    expect(text(html)).toContain('Try again');
    expect(renderToStaticMarkup(createElement(ProblemNote, { failure: null }))).toBe('');
  });

  it('say the refunds still to deduct only when there are some', () => {
    const owed = renderToStaticMarkup(
      createElement(ToDeduct, { amount: { amountMinor: 450, currency: 'USD' } }),
    );
    expect(text(owed)).toContain('Refunds still to deduct: $4.50 Taken from your next payout.');
    expect(
      renderToStaticMarkup(
        createElement(ToDeduct, { amount: { amountMinor: 0, currency: 'USD' } }),
      ),
    ).toBe('');
  });
});
