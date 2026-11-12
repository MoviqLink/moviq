import { useLang } from '../../shared/i18n/lang';
import { exploreEn, type ExploreDict } from './texts-en';
import { exploreEs } from './texts-es';

/** Explore's words in the language in use. */
export function useExploreT(): ExploreDict {
  return useLang() === 'es' ? exploreEs : exploreEn;
}
