import type { LivePosition } from '@moviq/contracts';

/** The groups of AIS ship type codes (ITU-R M.1371-5, table 53), as the card names them. */
export type ShipCategory =
  | 'wing-in-ground'
  | 'fishing'
  | 'towing'
  | 'dredging'
  | 'diving'
  | 'military'
  | 'sailing'
  | 'pleasure'
  | 'high-speed'
  | 'pilot'
  | 'rescue'
  | 'tug'
  | 'port-tender'
  | 'anti-pollution'
  | 'law-enforcement'
  | 'medical'
  | 'passenger'
  | 'cargo'
  | 'tanker'
  | 'other'
  | 'unspecified';

const SINGLE: Readonly<Record<number, ShipCategory>> = {
  30: 'fishing',
  31: 'towing',
  32: 'towing',
  33: 'dredging',
  34: 'diving',
  35: 'military',
  36: 'sailing',
  37: 'pleasure',
  50: 'pilot',
  51: 'rescue',
  52: 'tug',
  53: 'port-tender',
  54: 'anti-pollution',
  55: 'law-enforcement',
  58: 'medical',
};

const DECADES: Readonly<Record<number, ShipCategory>> = {
  2: 'wing-in-ground',
  4: 'high-speed',
  6: 'passenger',
  7: 'cargo',
  8: 'tanker',
  9: 'other',
};

/** The category of an AIS ship type code; codes the standard leaves unassigned are unspecified. */
export function shipCategory(code: number | null): ShipCategory {
  if (code === null) return 'unspecified';
  return SINGLE[code] ?? DECADES[Math.floor(code / 10)] ?? 'unspecified';
}

/** Whole minutes from `now` to `instant`, never negative: 0 is a train arriving now. */
export const minutesUntil = (instant: string, now: number): number =>
  Math.max(0, Math.floor((Date.parse(instant) - now) / 60_000));

/** `4 to 10 November`, `30 October to 5 November`, in New York days. */
export function dayRange(from: string, to: string, locale: string): { from: string; to: string } {
  const day = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'America/New_York', ...options });
  const month = (instant: string) => day({ month: 'numeric' }).format(new Date(instant));
  const sameMonth = month(from) === month(to);
  return {
    from: day(sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' }).format(
      new Date(from),
    ),
    to: day({ day: 'numeric', month: 'long' }).format(new Date(to)),
  };
}

/** Minutes for a stoppage: whole minutes from one up, seconds below one. */
export function durationText(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${String(whole)} s` : `${String(Math.round(whole / 60))} min`;
}

/** A possible stoppage with the names it is told with, or null without one. */
export function stallOf(position: LivePosition) {
  const { stall, station } = position;
  if (stall === null) return null;
  return { ...stall, toStop: station?.name ?? null };
}
