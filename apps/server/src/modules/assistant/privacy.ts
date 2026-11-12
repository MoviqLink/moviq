/**
 * Nothing that identifies a person leaves for the language model. The traveller's words are
 * stripped of what usually identifies someone (contact details, ticket and booking details,
 * names after a label, exact coordinates), and everything about to be sent is checked again:
 * if anything of that kind is still there, the message is blocked before it leaves.
 */

const REMOVED = '[removed]';

const BOOKING_LABELS = [
  'pnr',
  'booking(?: (?:reference|code|ref))?',
  'record locator',
  'confirmation(?: (?:code|number))?',
  'localizador',
  'c[oó]digo de reserva',
];
const NAME_LABELS = [
  '[Mm]y name is',
  '[Mm]e llamo',
  '[Pp]assenger',
  '[Pp]asajer[oa]',
  '[Nn]ame',
  '[Nn]ombre',
  'M[rs]s?',
  'Sra?',
  'Srta',
];
const CAPITALISED = "\\p{Lu}[\\p{L}'-]+";

const PERSONAL_DATA: readonly (readonly [kind: string, pattern: RegExp])[] = [
  ['email', /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.\p{L}{2,}/gu],
  ['identifier', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['coordinates', /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g],
  ['card or ticket number', /\b\d(?:[ -]?\d){12,18}\b/g],
  ['phone', /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\b\d{3}[\s.-])\d{3}[\s.-]?\d{3,4}\b/g],
  [
    'booking code',
    new RegExp(
      `\\b(?:${BOOKING_LABELS.join('|')})\\s*(?:n[º°o.]*\\s*)?[:#]?\\s*[A-Z0-9]{5,8}\\b`,
      'giu',
    ),
  ],
  ['seat', /\b(?:seat|asiento)\s*[:#]?\s*\d{1,2}[A-K]\b/giu],
  [
    'name',
    new RegExp(
      `\\b(?:${NAME_LABELS.join('|')})\\.?\\s*:?\\s+${CAPITALISED}(?:\\s+${CAPITALISED}){0,3}`,
      'gu',
    ),
  ],
];

/** The traveller's words with personal data replaced by `[removed]`. */
export function scrubPersonalData(text: string): string {
  return PERSONAL_DATA.reduce((current, [, pattern]) => current.replace(pattern, REMOVED), text);
}

/** The kind of personal data found in any of the texts, or undefined when there is none. */
export function findPersonalData(texts: readonly string[]): string | undefined {
  for (const [kind, pattern] of PERSONAL_DATA) {
    if (texts.some((text) => text.search(pattern) !== -1)) return kind;
  }
  return undefined;
}
