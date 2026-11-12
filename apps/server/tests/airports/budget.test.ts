import { describe, expect, it } from 'vitest';

import { FIDS_UNITS } from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import { createUnitAllowance } from '../../src/modules/data-platform/on-demand/aerodatabox-units.js';
import {
  createBoardBudget,
  TRAVELLER_RESERVE_UNITS,
} from '../../src/modules/data-platform/on-demand/board-budget.js';

/** When RapidAPI's month restarts, from the JFK capture's `x-ratelimit-api-units-reset`. */
const RENEWAL = new Date('2026-12-11T03:38:44Z');
const EVALUATION_ENDS = new Date('2026-12-16T05:00:00Z');

/** Units left and the month's restart, as RapidAPI's headers say them at `now`. */
function allowance(now: Date, remaining: number, renewsAt: Date) {
  const units = createUnitAllowance();
  units.observe(
    new Headers({
      'x-ratelimit-api-units-remaining': String(remaining),
      'x-ratelimit-api-units-reset': String(
        Math.round((renewsAt.getTime() - now.getTime()) / 1000),
      ),
    }),
    now,
  );
  return units;
}

/** Boards a budget allows in the UTC day starting at `day`, asked every minute. */
function boardsInADay(day: Date, remaining: number, renewsAt: Date, spreadUntil?: Date): number {
  const units = allowance(day, remaining, renewsAt);
  const budget = createBoardBudget(units, spreadUntil === undefined ? {} : { spreadUntil });
  let boards = 0;
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const at = new Date(day.getTime() + minute * 60_000);
    if (budget.refusal(FIDS_UNITS, at) !== undefined) continue;
    expect(units.take(FIDS_UNITS, at)).toBe(true);
    budget.spent(FIDS_UNITS, at);
    boards += 1;
  }
  return boards;
}

describe("the boards' share of the month", () => {
  it('keeps 100 units for travellers above the 40 never spent', () => {
    expect(TRAVELLER_RESERVE_UNITS).toBe(100);
  });

  it('on 11/11, with 394 units left until 11/12: 4 boards a day', () => {
    // (394 - 40 - 100) / 31 days = 8.2 units a day.
    expect(boardsInADay(new Date('2026-11-11T00:00:00Z'), 394, RENEWAL, EVALUATION_ENDS)).toBe(4);
  });

  it('on 1/12, with 360 left until 11/12: 10 boards, each airport every 7 hours', () => {
    // (360 - 40 - 100) / 11 days = 20 units a day.
    expect(boardsInADay(new Date('2026-12-01T00:00:00Z'), 360, RENEWAL, EVALUATION_ENDS)).toBe(10);
  });

  it('from the renewal to the end of 15/12: the 3-hour limit binds, not the units', () => {
    // (400 - 40 - 100) / 5 days = 52 units a day: 26 boards, above the 24 that 3 hours allow.
    const day = new Date('2026-12-12T00:00:00Z');
    const next = new Date('2027-01-10T03:38:44Z');
    expect(boardsInADay(day, 400, next, EVALUATION_ENDS)).toBe(26);
    // Without the evaluation's end, the same units spread over the new month: 4 a day.
    expect(boardsInADay(day, 400, next)).toBe(4);
  });

  it('says when the day is spent, and carries what a quiet day leaves over to the next', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const units = allowance(now, 360, RENEWAL);
    const budget = createBoardBudget(units);
    for (let board = 0; board < 10; board += 1) budget.spent(FIDS_UNITS, now);
    expect(budget.refusal(FIDS_UNITS, now)).toEqual({
      detail:
        'Boards spent 20 units today (UTC), their share of the 20 a day until the month renews.',
      retryAt: new Date('2026-12-02T00:00:00Z'),
    });
    // Nothing was taken from the units: tomorrow 220 are left over 10 days, 22 a day.
    const tomorrow = new Date('2026-12-02T00:00:00Z');
    let boards = 0;
    while (budget.refusal(FIDS_UNITS, tomorrow) === undefined) {
      budget.spent(FIDS_UNITS, tomorrow);
      boards += 1;
    }
    expect(boards).toBe(11);
  });

  it('without the gateway count yet, spreads over 31 days', () => {
    const budget = createBoardBudget(createUnitAllowance());
    const now = new Date('2026-11-11T00:00:00Z');
    // (400 - 40 - 100) / 31 days = 8.4 units a day.
    let boards = 0;
    while (budget.refusal(FIDS_UNITS, now) === undefined) {
      budget.spent(FIDS_UNITS, now);
      boards += 1;
    }
    expect(boards).toBe(4);
  });
});
