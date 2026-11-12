import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { moneyInDoubt } from '../../src/modules/operations/money-in-doubt.js';
import { holdRefundReference } from '../../src/modules/payments/holds/hold-context.js';
import { holdLedger } from '../../src/modules/payments/holds/hold-ledger.js';
import { reconcileRound } from '../../src/modules/payments/holds/hold-reconcile.js';
import {
  REFUND_ASKED_AGAIN_FOR_MS,
  REFUND_NEEDS_A_PERSON,
} from '../../src/modules/payments/holds/hold-refund-checks.js';
import { refundHold } from '../../src/modules/payments/holds/hold-refunds.js';
import { authorizeHold, captureHold } from '../../src/modules/payments/holds/hold-steps.js';
import { refusal } from './support/fake-paypal.js';
import { holdWorld, type HoldWorld } from './support/holds.js';

let world: HoldWorld;
const round = () => reconcileRound(world.ctx, { signal: new AbortController().signal }, 20);
const HOUR = 60 * 60_000;

beforeEach(async () => {
  world = await holdWorld();
});

afterEach(async () => {
  await world.temp.dispose();
});

const releaseOf = async (holdId: string) =>
  (
    await world.db.query({
      sql: 'SELECT status FROM payment_hold_releases WHERE hold_id = ?',
      args: [holdId],
    })
  ).rows[0]?.['status'];

describe('a release that is owed is never forgotten', () => {
  it('keeps voiding an authorization whose purchase was refused until PayPal confirms it', async () => {
    world.applied.refuse = true;
    const hold = await world.started();
    world.paypal.approve(hold.paypalOrderId ?? '');
    world.paypal.script('voidAuthorization', 'lose-request');
    world.paypal.script('voidAuthorization', 'lose-request');
    const first = await authorizeHold(world.ctx, hold);
    expect(first.ok).toBe(false);
    for (let index = 0; index < 4; index += 1) {
      world.clock.advance(HOUR);
      await round();
    }
    const after = await holdLedger.find(world.db, hold.id);
    expect(after?.status).toBe('voided');
    expect(world.paypal.order(hold.paypalOrderId ?? '')?.authorization?.status).toBe('VOIDED');
    expect(await releaseOf(hold.id)).toBe('released');
    expect(world.applied.authorized).toEqual([]);
    const voids = world.paypal.calls.filter((call) => call.method === 'voidAuthorization');
    expect(new Set(voids.map((call) => call.requestId))).toEqual(new Set([`${hold.id}:void`]));
  });

  it('keeps the release owed while PayPal turns the void away, and says why', async () => {
    world.applied.refuse = true;
    const hold = await world.started();
    world.paypal.approve(hold.paypalOrderId ?? '');
    const voidAuthorization = world.paypal.voidAuthorization.bind(world.paypal);
    let refusals = 2;
    world.paypal.voidAuthorization = (id, requestId) => {
      if (refusals === 0) return voidAuthorization(id, requestId);
      refusals -= 1;
      return Promise.reject(refusal('authorizations.void', 422, 'TRANSACTION_REFUSED'));
    };
    await authorizeHold(world.ctx, hold);
    world.clock.advance(HOUR);
    await round();
    expect((await holdLedger.find(world.db, hold.id))?.status).not.toBe('voided');
    for (let index = 0; index < 3; index += 1) {
      world.clock.advance(HOUR);
      await round();
    }
    expect((await holdLedger.find(world.db, hold.id))?.status).toBe('voided');
    expect(await releaseOf(hold.id)).toBe('released');
  });
});

describe('a refund PayPal has not confirmed is followed to its end', () => {
  async function captured() {
    const outcome = await captureHold(world.ctx, await world.held());
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.hold;
  }
  const line = { operation: 'missing:0', amount: { amountMinor: 255, currency: 'USD' as const } };
  const refundStatus = async () =>
    (await world.db.query('SELECT status FROM payment_hold_refunds')).rows[0]?.['status'];
  const refundRows = async () =>
    (
      await world.db.query(
        'SELECT operation, status, paypal_refund_id FROM payment_hold_refunds ORDER BY operation',
      )
    ).rows.map((row) =>
      z
        .object({
          operation: z.string(),
          status: z.string(),
          paypal_refund_id: z.string().nullable(),
        })
        .transform((r) => ({
          operation: r.operation,
          status: r.status,
          paypalRefundId: r.paypal_refund_id,
        }))
        .parse({ ...row }),
    );

  it('is pending, not done, while PayPal reviews it, and done once PayPal completes it', async () => {
    const hold = await captured();
    world.paypal.refundEndsAs('PENDING');
    const outcome = await refundHold(world.ctx, hold, line);
    expect(outcome).toMatchObject({ ok: true, status: 'pending' });
    world.clock.advance(HOUR);
    await round();
    expect(await refundStatus()).toBe('unknown');
    const refundId = world.paypal.order(hold.paypalOrderId ?? '')?.refunds[0]?.id ?? '';
    world.paypal.settleRefund(refundId, 'COMPLETED');
    world.clock.advance(HOUR);
    await round();
    expect(await refundStatus()).toBe('completed');
    expect(world.paypal.refunds()).toBe(1);
  });

  it('asks again with the same request id when the request was lost, and refunds once', async () => {
    const hold = await captured();
    world.paypal.script('refundCapture', 'lose-request');
    expect(await refundHold(world.ctx, hold, line)).toMatchObject({ ok: true, status: 'pending' });
    expect(world.paypal.refunds()).toBe(0);
    world.clock.advance(HOUR);
    await round();
    expect(await refundStatus()).toBe('completed');
    expect(world.paypal.refunds()).toBe(1);
  });

  it('finds the refund PayPal made when only its answer was lost, without refunding again', async () => {
    const hold = await captured();
    world.paypal.script('refundCapture', 'lose-answer');
    await refundHold(world.ctx, hold, line);
    world.clock.advance(24 * HOUR);
    await round();
    expect(await refundStatus()).toBe('completed');
    expect(world.paypal.refunds()).toBe(1);
    expect(world.paypal.calls.filter((call) => call.method === 'refundCapture')).toHaveLength(1);
  });

  it('settles two equal refunds, one request and one answer lost, each its own (regression)', async () => {
    const hold = await captured();
    const amount = { amountMinor: 255, currency: 'USD' as const };
    world.paypal.script('refundCapture', 'lose-request');
    await refundHold(world.ctx, hold, { operation: 'missing:A', amount });
    world.clock.advance(1000);
    world.paypal.script('refundCapture', 'lose-answer');
    await refundHold(world.ctx, hold, { operation: 'missing:B', amount });
    for (let index = 0; index < 4; index += 1) {
      world.clock.advance(HOUR);
      await round();
    }
    const rows = await refundRows();
    expect(rows.map((row) => row.status)).toEqual(['completed', 'completed']);
    expect(new Set(rows.map((row) => row.paypalRefundId)).size).toBe(2);
    const made = world.paypal.order(hold.paypalOrderId ?? '')?.refunds ?? [];
    expect(made.reduce((sum, refund) => sum + refund.amount.amountMinor, 0)).toBe(510);
    for (const row of rows) {
      const refund = made.find((candidate) => candidate.id === row.paypalRefundId);
      expect(refund?.customId).toBe(holdRefundReference(hold, row.operation));
    }
    const asked = world.paypal.calls.filter((call) => call.method === 'refundCapture').length;
    for (let index = 0; index < 3; index += 1) {
      world.clock.advance(24 * HOUR);
      await round();
    }
    expect(world.paypal.refunds()).toBe(2);
    expect(world.paypal.calls.filter((call) => call.method === 'refundCapture')).toHaveLength(
      asked,
    );
    expect(await refundRows()).toEqual(rows);
  });

  it('never takes a refund of the same amount made outside MovIQ for its own (regression)', async () => {
    const hold = await captured();
    await world.paypal.refundCapture(hold.paypalCaptureId ?? '', {
      amount: line.amount,
      requestId: 'refunded-in-the-paypal-dashboard',
    });
    world.paypal.script('refundCapture', 'lose-request');
    await refundHold(world.ctx, hold, line);
    world.clock.advance(HOUR);
    await round();
    const [row] = await refundRows();
    expect(row?.status).toBe('completed');
    const ours = world.paypal.order(hold.paypalOrderId ?? '')?.refunds[1];
    expect(row?.paypalRefundId).toBe(ours?.id);
    expect(ours?.customId).toBe(holdRefundReference(hold, line.operation));
  });

  it('past the days PayPal keeps its request id, is never asked again but left to a person', async () => {
    const hold = await captured();
    world.paypal.script('refundCapture', 'lose-request');
    await refundHold(world.ctx, hold, line);
    world.clock.advance(REFUND_ASKED_AGAIN_FOR_MS);
    for (let index = 0; index < 7; index += 1) {
      world.clock.advance(HOUR);
      await round();
    }
    expect(world.paypal.calls.filter((call) => call.method === 'refundCapture')).toHaveLength(1);
    expect(world.paypal.refunds()).toBe(0);
    expect(await refundStatus()).toBe('unknown');
    const doubt = await moneyInDoubt({ db: world.db, clock: world.clock });
    expect(doubt.obligations).toEqual([
      expect.objectContaining({
        kind: 'refund',
        amount: line.amount,
        lastError: REFUND_NEEDS_A_PERSON,
        escalation: 'attempts',
      }),
    ]);
  });
});
