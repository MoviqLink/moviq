import { en, type Dict } from './en';
import { es } from './es';
import { localeOf, useLang } from './lang';

const DICTS = { en, es } as const;

/** Texts for the language in use. */
export function useT(): Dict {
  return DICTS[useLang()];
}

/** The locale for dates and numbers in the language in use. */
export function useLocale(): string {
  return localeOf(useLang());
}
