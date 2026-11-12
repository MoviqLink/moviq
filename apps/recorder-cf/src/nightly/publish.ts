import type { RecorderStats } from '@moviq/contracts';

/** The lists of a day, written in this order after the rest of it. */
const LISTS = [
  'segments',
  'headways',
  'predictions',
  'stoppages',
  'incidents',
  'speeds',
  'tracking',
] as const;

/**
 * Rows written to text per step: a day of the city has some hundred thousand, 5.6 MB that take
 * 15 ms to write at once (`tools/cpu-budget.ts`), beyond the CPU of one alarm.
 */
export const ROWS_PER_STEP = 5_000;

/**
 * The JSON of a day, written a few thousand rows at a time: each step adds its rows as UTF-8,
 * and the last gives the whole document as a Blob of those bytes, which R2 stores as one.
 */
export function createPublication(stats: RecorderStats) {
  const { segments, headways, predictions, stoppages, incidents, speeds, tracking, ...rest } =
    stats;
  const lists = { segments, headways, predictions, stoppages, incidents, speeds, tracking };
  const encoder = new TextEncoder();
  // The rest of the day, open at its end for the lists to follow.
  const parts: Uint8Array[] = [encoder.encode(JSON.stringify(rest).slice(0, -1))];
  let list = 0;
  let row = 0;

  return {
    /** Writes the next rows; the document once every row is written. */
    step(): Blob | undefined {
      let budget = ROWS_PER_STEP;
      let text = '';
      while (budget > 0) {
        const name = LISTS[list];
        if (name === undefined) {
          parts.push(encoder.encode(`${text}}`));
          return new Blob(parts, { type: 'application/json' });
        }
        const rows: readonly unknown[] = lists[name];
        const end = Math.min(rows.length, row + budget);
        const written = rows.slice(row, end).map((value) => JSON.stringify(value));
        text += `${row === 0 ? `,"${name}":[` : ','}${written.join(',')}`;
        budget -= Math.max(1, end - row);
        row = end;
        if (row >= rows.length) {
          text += ']';
          list += 1;
          row = 0;
        }
      }
      parts.push(encoder.encode(text));
      return undefined;
    },
  };
}
