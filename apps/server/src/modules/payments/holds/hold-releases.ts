import type { HoldContext } from './hold-context.js';
import { holdLedger } from './hold-ledger.js';
import { releaseStore, type OwedRelease } from './hold-release-store.js';
import { settleHold } from './hold-settle.js';
import { voidHold } from './hold-steps.js';

/**
 * One attempt at an owed release: the hold is brought up to date with PayPal and, while PayPal
 * still holds the money, voided. If it is still held afterwards, the next attempt is scheduled
 * and the reason logged as an incident for the control room.
 */
export async function release(ctx: HoldContext, owed: OwedRelease): Promise<void> {
  const hold = await holdLedger.find(ctx.db, owed.holdId);
  if (hold === undefined) throw new Error(`Hold ${owed.holdId} owes a release but is gone.`);
  const settled = hold.status === 'unknown' ? ((await settleHold(ctx, hold)).hold ?? hold) : hold;
  const current =
    settled.status === 'authorized' ? ((await voidHold(ctx, settled)).hold ?? settled) : settled;
  if (current.status === 'voided' || current.status === 'failed') {
    await ctx.write((tx) => releaseStore.discharge(tx, current.id, ctx.clock.now()));
    return;
  }
  ctx.logger.error('money held for a refused purchase is not released yet', {
    holdId: current.id,
    status: current.status,
    detail: current.detail,
  });
  await ctx.write((tx) => releaseStore.reschedule(tx, owed, current.detail, ctx.clock.now()));
}
