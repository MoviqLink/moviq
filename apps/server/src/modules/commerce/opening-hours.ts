import { WEEKDAYS, type HoursProblem, type WeeklyHours } from '@moviq/contracts';

import {
  newYorkGtfsDate,
  toNewYorkWallClockText,
  weekdayOfGtfsDate,
} from '../../infrastructure/clock/new-york.js';

/** Whether an instant falls inside one of the stretches its New York weekday opens for. */
export function isOpenAt(hours: WeeklyHours, at: Date): boolean {
  const day = WEEKDAYS[weekdayOfGtfsDate(newYorkGtfsDate(at))];
  if (day === undefined) return false;
  const time = toNewYorkWallClockText(at).slice(11, 16);
  return hours[day].some((slot) => time >= slot.opens && time < slot.closes);
}

const DAY_NAMES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
} as const;

/** The server's sentence for hours it refuses. */
export function hoursRefusal(found: HoursProblem): string {
  switch (found.problem) {
    case 'ends-before-start':
      return `On ${DAY_NAMES[found.day]} a stretch closes before it opens.`;
    case 'overlap':
      return `On ${DAY_NAMES[found.day]} the stretches overlap or are out of order.`;
    case 'closed-all-week':
      return 'Your agent needs at least one opening stretch in the week.';
  }
}
