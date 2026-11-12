/** One CSV row keyed by the names in the header line, with surrounding spaces trimmed. */
export type CsvRow = Readonly<Record<string, string>>;

/**
 * Takes every record of a table, the header line first. `fields` is reused for the next record,
 * so it is valid only during the call: copy what must be kept.
 */
export type CsvRecordHandler = (fields: readonly string[]) => void;

export interface CsvReader {
  /** Takes the next piece of text; records complete in it are passed on at once. */
  write(text: string): void;
  /** Ends the text, passing on a last record that has no line break after it. */
  end(): void;
}

const QUOTE = '"';
const BOM = '﻿';

/**
 * Splits one record that holds quotes or carriage returns, field by field: a quote opens a
 * quoted part, where commas and line breaks are text and a doubled quote is one quote.
 */
function splitQuoted(text: string, fields: string[]): void {
  let cell = '';
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (quoted) {
      if (char !== QUOTE) cell += char;
      else if (text.charAt(at + 1) === QUOTE) {
        cell += QUOTE;
        at += 1;
      } else quoted = false;
    } else if (char === QUOTE) quoted = true;
    else if (char === ',') {
      fields.push(cell.trim());
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  fields.push(cell.trim());
}

/** Splits a record without quotes, the common case, by `indexOf` and without copying the line. */
function splitPlain(text: string, from: number, to: number, fields: string[]): void {
  let start = from;
  for (let comma = text.indexOf(',', start); comma !== -1 && comma < to;) {
    fields.push(text.slice(start, comma).trim());
    start = comma + 1;
    comma = text.indexOf(',', start);
  }
  fields.push(text.slice(start, to).trim());
}

/** The next place of `char` from `from`, kept until passed, so each one is looked for once. */
function nextOf(text: string, char: string): (from: number) => number {
  let found = -2;
  return (from) => {
    if (found !== -1 && found < from) found = text.indexOf(char, from);
    return found;
  };
}

/**
 * Finds the records of one piece of text: where each ends (the first line break outside quotes,
 * or -1 when the piece ends first) and whether it can be split without reading each character.
 */
function scanner(text: string): {
  end(from: number): number;
  plain(from: number, to: number): boolean;
} {
  const quote = nextOf(text, QUOTE);
  const carriageReturn = nextOf(text, '\r');
  return {
    end(from) {
      const lineBreak = text.indexOf('\n', from);
      const first = quote(from);
      if (first === -1 || (lineBreak !== -1 && lineBreak < first)) return lineBreak;
      let quoted = false;
      for (let at = first; at < text.length; at += 1) {
        const char = text.charAt(at);
        if (char === QUOTE) quoted = !quoted;
        else if (char === '\n' && !quoted) return at;
      }
      return -1;
    },
    plain(from, to) {
      const first = quote(from);
      const cr = carriageReturn(from);
      return (first === -1 || first >= to) && (cr === -1 || cr >= to - 1);
    },
  };
}

/**
 * Reads RFC 4180 CSV as it arrives, so a large table is never held whole and no object is made
 * per record: quoted fields may hold commas, doubled quotes and line breaks; CRLF and LF both end
 * a record; a leading BOM is dropped; blank lines are skipped.
 */
export function csvRecords(onRecord: CsvRecordHandler): CsvReader {
  const fields: string[] = [];
  let pending = '';
  let started = false;

  const emit = (text: string, from: number, to: number, plain: boolean): void => {
    fields.length = 0;
    if (plain) splitPlain(text, from, to, fields);
    else splitQuoted(text.slice(from, to), fields);
    if (fields.length === 1 && fields[0] === '') return;
    onRecord(fields);
  };

  return {
    write(piece) {
      if (piece.length === 0) return;
      const text = pending + (!started && piece.startsWith(BOM) ? piece.slice(1) : piece);
      started = true;
      const records = scanner(text);
      let start = 0;
      for (let end = records.end(start); end !== -1; end = records.end(start)) {
        emit(text, start, end, records.plain(start, end));
        start = end + 1;
      }
      pending = text.slice(start);
    },
    end() {
      if (pending === '') return;
      const records = scanner(pending);
      emit(pending, 0, pending.length, records.plain(0, pending.length));
      pending = '';
    },
  };
}

/**
 * A copy of a field that does not keep the text it was cut from alive: V8 holds the whole piece
 * of text behind a slice, so a few kept ids would hold the whole table.
 */
export function detached(field: string): string {
  return ` ${field}`.slice(1);
}

/** Records turned into rows keyed by the header, for the small tables read whole. */
export function csvRows(onRow: (row: CsvRow) => void): CsvRecordHandler {
  let header: readonly string[] | undefined;
  return (fields) => {
    if (header === undefined) {
      header = fields.map(detached);
      return;
    }
    const names = header;
    onRow(Object.fromEntries(names.map((name, index) => [name, detached(fields[index] ?? '')])));
  };
}

/** Rows keyed by the header, as `csvRecords` reads them. */
export function csvReader(onRow: (row: CsvRow) => void): CsvReader {
  return csvRecords(csvRows(onRow));
}
