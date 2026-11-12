import { inLanguage, unknownClock, unknownNumber, writtenMinutes } from '../city/guard.js';
import type { Lang } from '../planning/state.js';

/** The longest words Sara may say about a trip, as the contract allows. */
const MAX_WORDS_LENGTH = 700;

const MONEY = /\$\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?US\$/gi;
const DECIMAL_COMMA = /(\d),(\d)/g;

const amountsIn = (text: string): string[] =>
  (text.match(MONEY) ?? []).map((said) => said.replace(/[^\d.,]/g, '').replace(',', '.'));

/**
 * Why the model's words on a trip cannot be shown, or undefined when they can: too long, in
 * another language, or holding a price, a clock time or a number that the facts, the tools or
 * the traveller did not give.
 */
export function wordsProblem(
  text: string,
  lang: Lang,
  given: readonly string[],
): string | undefined {
  if (text.length > MAX_WORDS_LENGTH) return 'too long';
  if (!inLanguage(text, lang)) return 'wrong language';
  const prices = new Set(given.flatMap(amountsIn));
  if (amountsIn(text).some((amount) => !prices.has(amount))) return 'unknown price';
  const rest = text.replace(MONEY, ' ');
  if (unknownClock(rest, writtenMinutes(given))) return 'unknown time';
  const plain = (words: string) => words.replace(DECIMAL_COMMA, '$1.$2');
  if (unknownNumber(plain(rest), given.map(plain))) return 'unknown number';
  return undefined;
}
