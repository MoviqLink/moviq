/** New York's time zone: every hour on the roadmap is read on its clocks. */
export const NEW_YORK = 'America/New_York';

const wallClockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/**
 * The New York wall clock of an instant, as a `Date` whose local fields hold it. The chart draws
 * in the browser's own zone, so it is handed New York's clock and shows New York's hours anywhere.
 */
export function nyWallClock(instant: Date): Date {
  const parts = wallClockParts.formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
}

/** The instant at which New York's clocks show the local fields of `wall`. */
export function fromNyWallClock(wall: Date): Date {
  const target = Date.UTC(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
  );
  // Two passes settle the offset, also on the days the clocks change.
  let instant = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = nyWallClock(new Date(instant));
    const shownUtc = Date.UTC(
      shown.getFullYear(),
      shown.getMonth(),
      shown.getDate(),
      shown.getHours(),
      shown.getMinutes(),
      shown.getSeconds(),
    );
    instant += target - shownUtc;
  }
  return new Date(instant);
}
