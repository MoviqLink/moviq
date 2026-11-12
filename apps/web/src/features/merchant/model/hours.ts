import { hoursProblem, WEEKDAYS } from '@moviq/contracts';

import type { Weekday, WeeklyHours } from '../schemas';
import type { MerchantDict } from '../texts';

/** One stretch as the form edits it: two times as typed. */
export interface StretchForm {
  readonly opens: string;
  readonly closes: string;
}

export type HoursForm = Readonly<Record<Weekday, readonly StretchForm[]>>;

/** The most stretches a day can have, as in the contract. */
export const MAX_STRETCHES = 3;

export type HoursCheck =
  | { readonly ok: true; readonly hours: WeeklyHours }
  | {
      readonly ok: false;
      /** Per day, what is wrong with it; `week` when the whole week never opens. */
      readonly errors: Partial<Record<Weekday | 'week', string>>;
    };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `9:30` and `0930` read as `09:30`; anything else stays as typed, for the check to refuse. */
function tidy(text: string): string {
  const digits = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  return digits === null ? text.trim() : `${(digits[1] ?? '').padStart(2, '0')}:${digits[2] ?? ''}`;
}

/** The form with one stretch added to a day (after its last one) or taken out of it. */
export function withStretch(form: HoursForm, day: Weekday, index: number | 'add'): HoursForm {
  const slots = form[day];
  if (index !== 'add') return { ...form, [day]: slots.filter((_, at) => at !== index) };
  if (slots.length >= MAX_STRETCHES) return form;
  const last = slots.at(-1);
  const next =
    last === undefined
      ? { opens: '09:00', closes: '17:00' }
      : { opens: last.closes, closes: '24:00' };
  return { ...form, [day]: [...slots, next] };
}

/**
 * The hours as the server will accept them: New York times `HH:MM` (`24:00` closes at midnight),
 * each stretch closing after it opens, a day's stretches in order without overlapping, and at
 * least one opening in the week. The server checks it all again with the same rule.
 */
export function checkHours(form: HoursForm, t: MerchantDict['hours']): HoursCheck {
  const errors: Partial<Record<Weekday | 'week', string>> = {};
  const day = (slots: readonly StretchForm[]) =>
    slots.map((slot) => ({ opens: tidy(slot.opens), closes: tidy(slot.closes) }));
  const hours: WeeklyHours = {
    mon: day(form.mon),
    tue: day(form.tue),
    wed: day(form.wed),
    thu: day(form.thu),
    fri: day(form.fri),
    sat: day(form.sat),
    sun: day(form.sun),
  };
  for (const weekday of WEEKDAYS) {
    const bad = hours[weekday].some(
      (slot) => !TIME.test(slot.opens) || !(TIME.test(slot.closes) || slot.closes === '24:00'),
    );
    if (bad) errors[weekday] = t.format;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const found = hoursProblem(hours);
  if (found === null) return { ok: true, hours };
  if (found.day === null) return { ok: false, errors: { week: t.closedAllWeek } };
  return {
    ok: false,
    errors: { [found.day]: found.problem === 'overlap' ? t.overlap : t.endsBeforeStart },
  };
}
