import { toInstant } from '@moviq/contracts';

import type { UnitAllowance } from './aerodatabox-units.js';

/**
 * Units the boards never touch, on top of the allowance's own reserve: they stay for the
 * traveller's flight (50 Flight Status requests, about four watched flights).
 */
export const TRAVELLER_RESERVE_UNITS = 100;

const DAY_MS = 24 * 60 * 60_000;
/** Without the gateway's date, a month is taken to restart 31 days from now at the latest. */
const UNKNOWN_RENEWAL_MS = 31 * DAY_MS;

interface BoardBudgetOptions {
  /**
   * Boards spread their units evenly up to the earlier of the plan's renewal and this instant,
   * once it is ahead: the end of the days the boards are needed most.
   */
  readonly spreadUntil?: Date;
}

/** Why a board is not taken now, and when one may be. */
interface BoardRefusal {
  readonly detail: string;
  readonly retryAt: Date | null;
}

export interface BoardBudget {
  /** Undefined when a board of `cost` units may be taken now. */
  refusal(cost: number, now: Date): BoardRefusal | undefined;
  /** A board request was sent: its units count against the boards' share of the day. */
  spent(cost: number, now: Date): void;
}

/**
 * The boards' share of the month's units: what is left above the traveller's reserve, spread
 * evenly over the UTC days until the month renews. Each day's share is worked out on its first
 * request from what is left then, so units a quiet day leaves carry over to the days after it.
 */
export function createBoardBudget(
  units: UnitAllowance,
  options: BoardBudgetOptions = {},
): BoardBudget {
  let today = { day: '', share: 0, spent: 0 };
  const dayOf = (now: Date, available: number) => {
    const day = now.toISOString().slice(0, 10);
    if (day !== today.day) {
      const days = daysLeft(now, units.renewsAt(now), options.spreadUntil);
      today = { day, share: Math.max(0, available) / days, spent: 0 };
    }
    return today;
  };
  return {
    refusal(cost, now) {
      const available = units.spendable(now) - TRAVELLER_RESERVE_UNITS;
      if (available < cost) {
        return {
          detail:
            `Only ${String(Math.max(0, available))} units are left above the ` +
            `${String(TRAVELLER_RESERVE_UNITS)} kept for travellers' flights: boards wait for ` +
            'the month to renew.',
          retryAt: units.renewsAt(now),
        };
      }
      const day = dayOf(now, available);
      if (day.spent + cost <= day.share) return undefined;
      return {
        detail:
          `Boards spent ${String(day.spent)} units today (UTC), their share of the ` +
          `${String(Math.floor(day.share))} a day until the month renews.`,
        retryAt: new Date(Date.parse(`${day.day}T00:00:00Z`) + DAY_MS),
      };
    },
    spent(cost, now) {
      dayOf(now, units.spendable(now) - TRAVELLER_RESERVE_UNITS).spent += cost;
    },
  };
}

/** UTC days from the start of today to the horizon, today and the horizon's day included. */
function daysLeft(now: Date, renewsAt: Date | null, spreadUntil: Date | undefined): number {
  const renewal = renewsAt?.getTime() ?? now.getTime() + UNKNOWN_RENEWAL_MS;
  const until = spreadUntil?.getTime();
  const horizon = until !== undefined && until > now.getTime() ? Math.min(until, renewal) : renewal;
  const startOfDay = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.ceil((horizon - startOfDay) / DAY_MS));
}

/** Written into the evidence of a kept board. */
export function refusalText(refusal: BoardRefusal): string {
  return refusal.retryAt === null
    ? refusal.detail
    : `${refusal.detail} The next one may be taken from ${toInstant(refusal.retryAt)}.`;
}
