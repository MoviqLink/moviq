import { useLang } from '../../../shared/i18n/lang';
import { eventsEn, type EventsDict } from './texts-en';
import { eventsEs } from './texts-es';

/** The events layer's words in the language in use. */
export function useEventsT(): EventsDict {
  return useLang() === 'es' ? eventsEs : eventsEn;
}
