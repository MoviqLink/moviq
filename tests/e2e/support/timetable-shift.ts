import { DAY } from './clock-shift.js';
import { rewriteZipText } from './zip-text.js';

/** The weekday columns of `calendar.txt`, in their order. */
const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const GTFS_DATE = /^(\d{4})(\d{2})(\d{2})/;
const BOM = '\uFEFF';

/** A GTFS date (`20261110`) as days since 1970, read in UTC so no time zone moves it. */
function dayNumber(date: string): number {
  const match = GTFS_DATE.exec(date);
  if (match === null) throw new Error(`${date} is not a GTFS date.`);
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY;
}

/** A GTFS date, or the date that starts `feed_version` (`20261028-fall…`), moved by whole days. */
function moveDate(text: string, days: number): string {
  if (text === '') return text;
  const moved = new Date((dayNumber(text) + days) * DAY).toISOString().slice(0, 10);
  return moved.replaceAll('-', '') + text.slice(8);
}

/** The New York date of an instant, as GTFS writes it. */
function newYorkDate(instantMs: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(instantMs);
  return date.replaceAll('-', '');
}

/** Whole days from the service day a timetable was captured for to the New York date of `now`. */
export function daysSince(serviceDay: string, nowMs: number): number {
  return dayNumber(newYorkDate(nowMs)) - dayNumber(serviceDay);
}

interface Table {
  readonly columns: readonly string[];
  readonly rows: readonly string[][];
  readonly lineEnd: string;
  readonly bom: boolean;
}

/** A small GTFS table without quoted fields; one with quotes is refused, never misread. */
function readTable(text: string): Table {
  if (text.includes('"')) throw new Error('A timetable table with quoted fields.');
  const bom = text.startsWith(BOM);
  const lineEnd = text.includes('\r\n') ? '\r\n' : '\n';
  const [header = '', ...lines] = (bom ? text.slice(1) : text).split(/\r?\n/);
  const rows = lines.filter((line) => line !== '').map((line) => line.split(','));
  return { columns: header.split(','), rows, lineEnd, bom };
}

function writeTable(table: Table): string {
  const lines = [table.columns, ...table.rows].map((cells) => cells.join(','));
  return `${table.bom ? BOM : ''}${lines.join(table.lineEnd)}${table.lineEnd}`;
}

/** The table with `move` applied to the named columns of every row. */
function moveColumns(text: string, names: readonly string[], move: (value: string) => string) {
  const table = readTable(text);
  const indexes = names.map((name) => table.columns.indexOf(name)).filter((index) => index >= 0);
  const rows = table.rows.map((row) =>
    row.map((value, index) => (indexes.includes(index) ? move(value) : value)),
  );
  return writeTable({ ...table, rows });
}

/** A service that ran on a weekday runs `days` later in the week: its flags turn with it. */
function turnWeekdays(text: string, days: number): string {
  const table = readTable(text);
  const indexes = WEEKDAYS.map((name) => table.columns.indexOf(name));
  if (indexes.some((index) => index < 0)) throw new Error('calendar.txt lacks a weekday.');
  const turn = ((days % 7) + 7) % 7;
  const rows = table.rows.map((row) => {
    const flags = indexes.map((index) => row[index] ?? '0');
    const turned = [...row];
    indexes.forEach((index, weekday) => {
      turned[index] = flags[(weekday - turn + 7) % 7] ?? '0';
    });
    return turned;
  });
  return writeTable({ ...table, rows });
}

/**
 * A static GTFS capture moved by whole days: its calendars, exceptions, feed dates and the date
 * of its version, so that the day it was trimmed for falls `days` later. Stop times stay: they
 * count from the start of each service day. Every other table is copied as captured.
 */
export function shiftTimetable(zip: Uint8Array, days: number): Uint8Array {
  if (days === 0) return zip;
  const move = (value: string) => moveDate(value, days);
  // A version need not start with a date; when it does, the date moves with the rest.
  const moveVersion = (value: string) => (GTFS_DATE.test(value) ? move(value) : value);
  return rewriteZipText(zip, {
    'calendar.txt': (text) =>
      moveColumns(turnWeekdays(text, days), ['start_date', 'end_date'], move),
    'calendar_dates.txt': (text) => moveColumns(text, ['date'], move),
    'feed_info.txt': (text) =>
      moveColumns(
        moveColumns(text, ['feed_start_date', 'feed_end_date'], move),
        ['feed_version'],
        moveVersion,
      ),
  });
}
