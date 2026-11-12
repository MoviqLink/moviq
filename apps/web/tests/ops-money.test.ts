import type { MoneyInDoubt, MoneyObligation } from '@moviq/contracts';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createOpsApi } from '../src/features/ops/api';
import { opsHref, parseOpsPath } from '../src/features/ops/routes';
import { EscalationCell, KindCell } from '../src/features/ops/views/money/columns';
import { MoneyBody } from '../src/features/ops/views/money/MoneyView';
import { createApiClient } from '../src/shared/api/client';

// The screen is rendered in Spanish whatever the language of the machine running the tests.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'es-ES' } });
});

const T0 = '2026-11-11T12:00:00.000Z';

function obligation(fields: Partial<MoneyObligation>): MoneyObligation {
  return {
    id: 'hold-release:h1',
    kind: 'hold-release',
    reference: 'hold h1',
    status: 'owed',
    amount: { amountMinor: 1200, currency: 'USD' },
    since: T0,
    attempts: 6,
    lastError: 'authorizations.void: unknown, HTTP 503',
    nextCheckAt: T0,
    escalation: 'attempts',
    ...fields,
  };
}

const hours = {
  'hold-release': 1,
  payment: 1,
  refund: 24,
  'payout-batch': 24,
  'merchant-balance': 336,
};

function money(obligations: MoneyObligation[]): MoneyInDoubt {
  const amountMinor = obligations.reduce((sum, item) => sum + item.amount.amountMinor, 0);
  return {
    generatedAt: T0,
    thresholds: { attempts: 6, hours },
    totals: {
      open: obligations.length,
      escalated: obligations.filter((item) => item.escalation !== null).length,
      amount: { amountMinor, currency: 'USD' },
    },
    obligations,
  };
}

const ROWS = [
  obligation({}),
  obligation({
    id: 'payout-batch:b1',
    kind: 'payout-batch',
    reference: 'batch b1',
    status: 'processing',
    amount: { amountMinor: 2850, currency: 'USD' },
    attempts: null,
    lastError: null,
    escalation: null,
  }),
];

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const cell = (data: MoneyObligation) =>
  ({ data }) as unknown as CustomCellRendererProps<MoneyObligation>;

describe('money in doubt in the control room', () => {
  it('has its own address', () => {
    expect(opsHref.money).toBe('#/ops/money');
    expect(parseOpsPath(['money'])).toEqual({ name: 'money' });
    expect(parseOpsPath(['money', 'x'])).toEqual({ name: 'not-found' });
  });

  it('reads the list and refuses an answer outside the contract', async () => {
    const answer = money(ROWS);
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(answer))));
    const ops = createOpsApi(createApiClient(fetch));
    await expect(ops.money(new AbortController().signal)).resolves.toEqual(answer);
    expect(fetch.mock.calls[0]).toEqual(['/api/ops/money', expect.anything()]);
    const broken = createOpsApi(
      createApiClient(() => Promise.resolve(new Response(JSON.stringify({ obligations: 2 })))),
    );
    await expect(broken.money(new AbortController().signal)).rejects.toMatchObject({
      failure: { kind: 'contract' },
    });
  });

  it('draws the totals, the escalation rule and the grid', () => {
    const html = renderToStaticMarkup(
      createElement(MoneyBody, { money: money(ROWS), narrow: false }),
    );
    const said = text(html);
    expect(said).toContain('Abiertas 2');
    expect(said).toContain('Escaladas 1');
    expect(said).toMatch(/Importe en duda 40,50\s*US\$/);
    expect(said).toContain('Se escala tras 6 consultas fallidas seguidas');
    expect(said).toContain('saldos de comercio 14 d');
    expect(html).toContain('aria-label="Dinero aún sin confirmar con PayPal"');
    expect(said).not.toContain('Nada en duda');
  });

  it('names each obligation and why it is escalated', () => {
    const [release, batch] = ROWS as [MoneyObligation, MoneyObligation];
    expect(text(renderToStaticMarkup(createElement(KindCell, cell(release))))).toContain(
      'Liberar autorización hold h1',
    );
    const escalated = renderToStaticMarkup(createElement(EscalationCell, cell(release)));
    expect(escalated).toContain('st-unavailable');
    expect(text(escalated)).toContain('Consultas fallidas');
    expect(text(renderToStaticMarkup(createElement(EscalationCell, cell(batch))))).toContain(
      'Reintentando',
    );
  });

  it('says plainly when nothing is in doubt, without an empty grid', () => {
    const html = renderToStaticMarkup(createElement(MoneyBody, { money: money([]), narrow: true }));
    expect(text(html)).toContain('Nada en duda');
    expect(text(html)).toContain('ningún comercio debe reembolsos');
    expect(html).not.toContain('role="region"');
  });
});
