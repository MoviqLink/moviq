import { scanRefusalReasonSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { conversationSteps, preferenceTags } from '../../src/features/merchant/model/conversation';
import {
  lineText,
  nextStep,
  refundSaid,
  scanResult,
} from '../../src/features/merchant/model/counter';
import { latestNeeds } from '../../src/features/merchant/model/customers';
import { problemOf } from '../../src/features/merchant/model/problem';
import { checkRules, formOf } from '../../src/features/merchant/model/rules';
import { merchantEn, merchantEs } from '../../src/features/merchant/texts';
import { formatMoney } from '../../src/shared/journey/money';
import { CONVERSATION } from './conversation';

const dishes = new Map([['tr-tonkotsu', 'Tonkotsu ramen']]);
const status = (value: keyof typeof merchantEn.status) => merchantEn.status[value];
const steps = (t = merchantEn, locale = 'en-US') =>
  conversationSteps(CONVERSATION, { t: t.conversation, locale, dishes }, status);

describe('the conversation between Sara and the merchant agent (F-J9-13)', () => {
  it('keeps every message in order, with who said it', () => {
    const shown = steps();
    expect(shown.map((step) => step.seq)).toEqual(CONVERSATION.map((entry) => entry.seq));
    expect(shown.map((step) => step.who)).toEqual(CONVERSATION.map((entry) => entry.message.from));
  });

  it('says the need with only the preferences that touch the menu', () => {
    const [need] = steps();
    expect(need?.title).toBe('Mia would like ramen');
    expect(need?.lines).toEqual([
      'A meal',
      'Pickup between 11:10 AM and 11:40 AM',
      'Allergic to peanuts',
      'Without scallions',
      'No alcohol',
      'Drink: cola',
    ]);
  });

  it('shows the agent question, the answer, and the offer with dish names and the server price', () => {
    const [, ask, answer, offer] = steps();
    expect(ask).toMatchObject({ title: 'Asks', quoted: ['Mild or hot for the Tonkotsu ramen?'] });
    expect(answer?.lines).toEqual(['from the traveller’s saved tastes']);
    expect(offer?.title).toBe('Offers it for $16.16, ready at 11:20 AM');
    expect(offer?.lines).toEqual(['Tonkotsu ramen, without scallions, with chili oil']);
  });

  it('says a refusal for the agent maximum discount as the requirement words it', () => {
    expect(steps()[4]).toMatchObject({
      tone: 'rejected',
      title: 'Rejected: goes over your agent’s maximum discount',
      quoted: ['The discount is above 5%.'],
    });
    expect(steps(merchantEs, 'es-ES')[4]?.title).toBe(
      'Rechazada: supera el descuento máximo de tu agente',
    );
  });

  it('shows an accepted check with the reward the server set, and a dish without a known name by id', () => {
    const shown = steps();
    expect(shown[6]?.lines).toEqual(['2 × Dish tr-gyoza']);
    expect(shown[7]).toMatchObject({ tone: 'accepted', lines: ['reward $1.79 (10 %)'] });
    expect(shown[5]).toMatchObject({
      tone: 'rejected',
      quoted: ['The price was written as text.'],
    });
  });

  it('ends with the payment, the order and the outcome', () => {
    const shown = steps();
    expect(shown.slice(8).map((step) => step.title)).toEqual([
      'Recommends your offer to the traveller',
      '$16.11 held in the traveller’s PayPal',
      'Order T-1001 · Reserved',
      'The traveller declined the offer',
      'Closed: no offer passed the checks',
    ]);
    expect(shown.at(-1)?.tone).toBe('closed');
  });
});

describe('customers', () => {
  it('carry only the tags of their latest need (F-J9-06)', () => {
    const need = CONVERSATION[0]?.message;
    if (need?.type !== 'need') throw new Error('the fixture starts with a need');
    const older = { ...need, preferences: { ...need.preferences, allergies: [] } };
    const request = (at: string, message: typeof need) => ({
      threadId: at,
      at,
      alias: 'Mia',
      craving: 'ramen',
      status: 'offered' as const,
      offer: null,
      conversation: [{ seq: 1, at, message }],
    });
    const latest = latestNeeds([
      request('2026-11-11T16:00:00.000Z', need),
      request('2026-11-10T16:00:00.000Z', older),
    ]);
    const tags = preferenceTags(
      latest.get('Mia')?.preferences ?? older.preferences,
      merchantEn.conversation,
    );
    expect(tags).toEqual(['Allergic to peanuts', 'Without scallions', 'No alcohol', 'Drink: cola']);
    expect(tags.join(' ')).not.toContain('Mia');
  });
});

describe('the counter', () => {
  it('moves a ticket forward and leaves collecting to the scan (F-J9-04)', () => {
    expect(nextStep('reserved')).toBe('preparing');
    expect(nextStep('preparing')).toBe('ready');
    expect(nextStep('ready')).toBe('scan');
    expect(nextStep('picked_up')).toBeNull();
    expect(nextStep('cancelled')).toBeNull();
    expect(lineText({ name: 'Gyoza', quantity: 2, changes: 'without soy' })).toBe(
      '2 × Gyoza · without soy',
    );
  });

  it('reads a scan as the server answered it (F-J9-05)', () => {
    const charged = { amountMinor: 1611, currency: 'USD' as const };
    expect(scanResult({ orderId: 'o', code: 'T-1001', status: 'picked_up', charged })).toEqual({
      kind: 'charged',
      code: 'T-1001',
      amount: charged,
    });
    expect(
      scanResult({ orderId: 'o', code: 'T-1001', status: 'ready', message: 'Scan again.' }),
    ).toEqual({ kind: 'confirming', code: 'T-1001' });
    const refusal = {
      error: {
        code: 'conflict',
        message: 'This code has expired.',
        requestId: 'r',
        reason: 'expired',
      },
    } as const;
    expect(scanResult(refusal)).toEqual({ kind: 'refused', reason: 'expired' });
  });

  it('says every refused scan in both languages, what happened and what to do', () => {
    for (const t of [merchantEn, merchantEs]) {
      for (const reason of Object.values(scanRefusalReasonSchema.enum)) {
        expect(t.scan.reasons[reason].what).not.toBe('');
        expect(t.scan.reasons[reason].todo).not.toBe('');
      }
    }
    expect(merchantEs.scan.reasons.expired.what).toBe(
      'Este código ha caducado: cada código dura diez minutos.',
    );
  });
});

describe('a refund of missing lines', () => {
  const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });
  const money = (amount: { amountMinor: number; currency: 'USD' }) => formatMoney(amount, 'en-US');
  const t = merchantEn.refund;

  it('says refunded only what PayPal confirmed (200)', () => {
    const answer = { ok: true, message: 'Refunded.', refunded: usd(300), pending: usd(0) };
    expect(refundSaid(answer, t, money)).toEqual(['$3.00 refunded through PayPal.']);
  });

  it('says what PayPal has not confirmed as a refund in progress, never as refunded (202)', () => {
    const answer = {
      ok: true,
      message: 'PayPal is confirming.',
      refunded: usd(0),
      pending: usd(450),
    };
    const said = refundSaid(answer, t, money);
    expect(said).toEqual(['Refund in progress: $4.50, until PayPal confirms it.']);
    expect(said.join(' ')).not.toContain('refunded');
    const both = { ...answer, refunded: usd(300) };
    // Intl writes a no-break space before the currency in Spanish.
    const spanish = refundSaid(both, merchantEs.refund, (m) => formatMoney(m, 'es-ES'));
    expect(spanish.map((line) => line.replace(/\u00a0/g, ' '))).toEqual([
      '3,00 US$ devueltos con PayPal.',
      'Reembolso en curso: 4,50 US$, hasta que PayPal lo confirme.',
    ]);
  });
});

describe('"Your agent" rules (F-J9-08)', () => {
  const rules = {
    maxDiscountPercent: 25,
    minMarginPercent: 60,
    ordersPerQuarterHour: 4,
    prepMinutes: 15,
    featuredItemIds: ['tr-miso-vegan'],
  };
  const t = merchantEn.agent;

  it('accepts the rules the server would, as numbers', () => {
    expect(checkRules(formOf(rules), 10, t)).toEqual({ ok: true, rules });
  });

  it('refuses a maximum discount below the program minimum, saying the minimum', () => {
    const form = formOf({ ...rules, maxDiscountPercent: 5 });
    expect(checkRules(form, 10, t)).toEqual({
      ok: false,
      errors: { maxDiscountPercent: 'It must be at least 10 %, MovIQ’s minimum reward.' },
    });
  });

  it('refuses numbers outside the contract bounds, text and more than five dishes', () => {
    const form = formOf({ ...rules, featuredItemIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    const typed = {
      ...form,
      values: {
        ...form.values,
        prepMinutes: '2',
        ordersPerQuarterHour: 'ten',
        minMarginPercent: '',
      },
    };
    const checked = checkRules(typed, 10, t);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errors).toEqual({
      prepMinutes: 'A whole number from 3 to 90.',
      ordersPerQuarterHour: 'A whole number from 1 to 40.',
      minMarginPercent: 'A whole number from 0 to 300.',
      featuredItemIds: 'Choose up to five dishes.',
    });
  });
});

describe('problems', () => {
  const t = merchantEn.problem;

  it('say what happened and what to do, with the server’s words and reference', () => {
    expect(
      problemOf(
        {
          kind: 'http',
          status: 403,
          code: 'forbidden',
          message: 'This request is not yours.',
          requestId: 'req-1',
        },
        t,
      ),
    ).toEqual({
      what: 'This request is not yours.',
      serverWords: true,
      todo: t.forbidden,
      reference: 'req-1',
    });
    expect(problemOf({ kind: 'network', timedOut: true }, t)).toMatchObject({
      what: t.timedOut,
      todo: t.checkConnection,
    });
    expect(problemOf({ kind: 'contract', path: '/api/merchant/today' }, t)?.what).toBe(t.contract);
    expect(
      problemOf(
        { kind: 'http', status: 401, code: 'unauthorized', message: 'x', requestId: null },
        t,
      ),
    ).toMatchObject({ what: t.ended, todo: t.choose });
    expect(
      problemOf({ kind: 'http', status: 502, code: null, message: null, requestId: null }, t),
    ).toMatchObject({ what: 'The server answered with an error (502).', serverWords: false });
    expect(problemOf({ kind: 'aborted' }, t)).toBeNull();
  });
});
