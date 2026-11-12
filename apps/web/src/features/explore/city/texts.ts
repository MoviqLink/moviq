import { useLang } from '../../../shared/i18n/lang';
import { cardEn, type CardDict } from './texts-card-en';
import { cardEs } from './texts-card-es';
import { cityEn, type CityDict } from './texts-en';
import { cityEs } from './texts-es';

/** The city layers' words in the language in use. */
export function useCityT(): CityDict {
  return useLang() === 'es' ? cityEs : cityEn;
}

/** The words of the cards of the city layers in the language in use. */
export function useCityCardT(): CardDict {
  return useLang() === 'es' ? cardEs : cardEn;
}
