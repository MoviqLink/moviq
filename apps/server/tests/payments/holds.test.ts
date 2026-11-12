import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { parseRow } from '../../src/infrastructure/database/rows.js';
import type { HoldContext } from '../../src/modules/payments/holds/hold-context.js';
import { holdLedger, type HoldRecord } from '../../src/modules/payments/holds/hold-ledger.js';
import { reconcileRound } from '../../src/modules/payments/holds/hold-reconcile.js';
import { refundHold } from '../../src/modules/payments/holds/hold-refunds.js';
import {
  authorizeHold,
  captureHold,
  startHold,
  voidHold,
} from '../../src/modules/payments/holds/hold-steps.js';
import { HOLD_TRANSITIONS } from '../../src/modules/payments/holds/hold-transitions.js';
import type { ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import type { FakeHoldPayPal } from './support/fake-paypal-holds.js';
import { holdWorld, presentation, purpose, type Applied } from './support/holds.js';

let clock: ManualClock;
let temp: TempDatabase;
let db: Database;
let paypal: FakeHoldPayPal;
let applied: Applied;
let ctx: HoldContext;
let travellerId: string;
let held: () => Promise<HoldRecord>;

beforeEach(async () => {
  ({ clock, temp, db, paypal, applied, ctx, travellerId, held } = await holdWorld());
});

afterEach(async () => {
  await temp.dispose();
});

const transitionSchema = z.object({ from_status: z.string(), to_status: z.string() });

describe('holds: authorize when reserving, capture at pickup, void when cancelled', () => {
  it('keeps the allowed transitions equal in code and in the database', async () => {
    const rows = await db.query('SELECT from_status, to_status FROM payment_hold_transitions');
    const stored = rows.rows
      .map((row) => parseRow(transitionSchema, row, 'transitions'))
      .map((r) => `${r.from_status}>${r.to_status}`);
    const code = Object.entries(HOLD_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}>${to}`),
    );
    expect(stored.sort()).toEqual(code.sort());
  });

  it('opens one AUTHORIZE order with MovIQ, the language and the lines, however often it is asked', async () => {
    const input = {
      travellerId,
      purpose,
      amount: { amountMinor: 1440, currency: 'USD' as const },
      description: 'Tsuki Ramen House (demo)',
      presentation,
    };
    const first = await startHold(ctx, input);
    const again = await startHold(ctx, input);
    expect(first.ok && again.ok && first.hold.id === again.hold.id).toBe(true);
    expect(paypal.calls.filter((call) => call.method === 'createOrder')).toHaveLength(1);
    const order = paypal.order(first.ok ? (first.hold.paypalOrderId ?? '') : '');
    expect(order?.input.intent).toBe('AUTHORIZE');
    expect(order?.input.presentation?.brandName).toBe('MovIQ');
    expect(order?.input.presentation?.locale).toBe('es-US');
  });

  it('holds nothing and applies nothing until the buyer approves in PayPal', async () => {
    const started = await startHold(ctx, {
      travellerId,
      purpose,
      amount: { amountMinor: 1440, currency: 'USD' },
      description: 'Demo',
      presentation,
    });
    if (!started.ok) throw new Error(started.message);
    const early = await authorizeHold(ctx, started.hold);
    expect(early.ok).toBe(false);
    expect(early.hold?.status).toBe('created');
    expect(applied.authorized).toEqual([]);
    paypal.approve(started.hold.paypalOrderId ?? '');
    const later = await authorizeHold(ctx, early.hold ?? started.hold);
    expect(later.ok && later.hold.status).toBe('authorized');
    expect(applied.authorized).toHaveLength(1);
  });

  it('charges once however many times the code is scanned, even at the same time', async () => {
    const hold = await held();
    const results = await Promise.allSettled([
      captureHold(ctx, hold),
      captureHold(ctx, hold),
      captureHold(ctx, hold),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const latest = await holdLedger.find(db, hold.id);
    const again = await captureHold(ctx, latest ?? hold);
    expect(again.ok && again.hold.status).toBe('captured');
    expect(paypal.captures()).toBe(1);
    expect(applied.captured).toEqual([hold.id]);
  });

  it('settles a capture whose answer was lost from what PayPal did, without charging again', async () => {
    const hold = await held();
    paypal.script('captureAuthorization', 'lose-answer');
    const lost = await captureHold(ctx, hold);
    expect(lost.ok && lost.hold.status).toBe('unknown');
    expect(applied.captured).toEqual([]);
    clock.advance(60_000);
    await reconcileRound(ctx, { signal: new AbortController().signal }, 10);
    expect((await holdLedger.find(db, hold.id))?.status).toBe('captured');
    expect(paypal.captures()).toBe(1);
    expect(applied.captured).toEqual([hold.id]);
  });

  it('voids the authorization when cancelled, and refuses to void what was charged', async () => {
    const hold = await held();
    const voided = await voidHold(ctx, hold);
    expect(voided.ok && voided.hold.status).toBe('voided');
    expect(applied.voided).toEqual([hold.id]);
    expect(paypal.order(hold.paypalOrderId ?? '')?.authorization?.status).toBe('VOIDED');
  });

  it('refuses to void a hold that was already charged', async () => {
    const captured = await captureHold(ctx, await held());
    if (!captured.ok) throw new Error(captured.message);
    const voided = await voidHold(ctx, captured.hold);
    expect(voided.ok).toBe(false);
    expect(paypal.calls.filter((call) => call.method === 'voidAuthorization')).toHaveLength(0);
  });

  it('releases the money when what it buys cannot be applied, and keeps nothing', async () => {
    applied.refuse = true;
    const started = await startHold(ctx, {
      travellerId,
      purpose,
      amount: { amountMinor: 1440, currency: 'USD' },
      description: 'Demo',
      presentation,
    });
    if (!started.ok) throw new Error(started.message);
    paypal.approve(started.hold.paypalOrderId ?? '');
    const outcome = await authorizeHold(ctx, started.hold);
    expect(outcome.ok).toBe(false);
    expect(outcome.hold?.status).toBe('voided');
    expect(paypal.order(started.hold.paypalOrderId ?? '')?.authorization?.status).toBe('VOIDED');
  });

  it('refunds a missing line once, and never more than was charged', async () => {
    const hold = await held();
    const captured = await captureHold(ctx, hold);
    if (!captured.ok) throw new Error(captured.message);
    const line = { operation: 'missing:1', amount: { amountMinor: 255, currency: 'USD' as const } };
    expect((await refundHold(ctx, captured.hold, line)).ok).toBe(true);
    expect((await refundHold(ctx, captured.hold, line)).ok).toBe(true);
    expect(paypal.refunds()).toBe(1);
    const tooMuch = await refundHold(ctx, captured.hold, {
      operation: 'missing:0',
      amount: { amountMinor: 1400, currency: 'USD' },
    });
    expect(tooMuch.ok).toBe(false);
    expect(paypal.refunds()).toBe(1);
  });
});
