import { z } from 'zod';

/**
 * AeroDataBox's free Basic plan on RapidAPI: 400 API units a month and one request a second, for
 * non-commercial use with attribution. Units are not requests: Flight Status (single day) is a
 * Tier 2 endpoint, and a Tier 2 request costs 2 units (aerodatabox.com/pricing, read on
 * 11/11/2026). The gateway confirmed both on 11/11/2026 with `x-tier: Tier 2` and
 * `x-ratelimit-api-units-remaining` going from 400 to 396 after two requests.
 */
export const FLIGHT_STATUS_UNITS = 2;
export const MONTHLY_UNITS = 400;
/** Never spent by MovIQ: room for a restart before the gateway's count is known, and for checks. */
export const RESERVED_UNITS = 40;

const DAY_MS = 24 * 60 * 60_000;
/** Without the gateway's count, a rolling window holds any billing month, which lasts 31 days at most. */
const WINDOW_MS = 31 * DAY_MS;

/** A header absent (null) or not a whole number is not a count. */
const countSchema = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);

export interface UnitAllowance {
  /** Holds the units of one request; false, holding nothing, when that would dip into the reserve. */
  take(units: number, now: Date): boolean;
  /** Reads what the gateway says is left after a request, and when its count restarts. */
  observe(headers: Headers, now: Date): void;
  /** The units MovIQ may still spend, above the reserve. */
  spendable(now: Date): number;
  /** When the gateway's month restarts, once it has said so; null before. */
  renewsAt(now: Date): Date | null;
}

/**
 * The month's units in this process. Its own count covers a rolling 31 days; once the gateway
 * has answered, its count (shared by every process using the key) is trusted as well, and the
 * lower of the two decides. A restart forgets the own count, so at most one request is sent
 * before the gateway's count is known again: the reserve covers it.
 */
export function createUnitAllowance(
  limit: number = MONTHLY_UNITS,
  reserve: number = RESERVED_UNITS,
): UnitAllowance {
  let spent: { readonly at: number; readonly units: number }[] = [];
  let gateway: { remaining: number; readonly resetAt: number } | undefined;

  const spendable = (now: Date): number => {
    const time = now.getTime();
    if (gateway !== undefined && time >= gateway.resetAt) {
      const resetAt = gateway.resetAt;
      spent = spent.filter((entry) => entry.at >= resetAt);
      gateway = undefined;
    }
    spent = spent.filter((entry) => time - entry.at < WINDOW_MS);
    const own = limit - spent.reduce((total, entry) => total + entry.units, 0);
    const left = gateway === undefined ? own : Math.min(own, gateway.remaining);
    return Math.max(0, left - reserve);
  };

  return {
    take(units, now) {
      if (spendable(now) < units) return false;
      spent.push({ at: now.getTime(), units });
      if (gateway !== undefined) gateway.remaining -= units;
      return true;
    },
    observe(headers, now) {
      const remaining = countSchema.safeParse(headers.get('x-ratelimit-api-units-remaining'));
      const reset = countSchema.safeParse(headers.get('x-ratelimit-api-units-reset'));
      if (!remaining.success || !reset.success) return;
      gateway = { remaining: remaining.data, resetAt: now.getTime() + reset.data * 1000 };
    },
    spendable,
    renewsAt(now) {
      // Counting first forgets a restart already passed.
      spendable(now);
      return gateway === undefined ? null : new Date(gateway.resetAt);
    },
  };
}
