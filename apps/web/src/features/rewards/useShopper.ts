import { useState } from 'react';

import { useLang } from '../../shared/i18n/lang';
import { deviceStore, readShopper, saveShopper, type Shopper } from './model/shopper';

/** The alias and tastes of this device, and a way to change them. */
export function useShopper(): {
  readonly shopper: Shopper;
  readonly save: (s: Shopper) => boolean;
} {
  const lang = useLang();
  const [shopper, setShopper] = useState(() => readShopper(deviceStore(), lang));
  return {
    shopper,
    save: (next) => {
      if (!saveShopper(deviceStore(), next)) return false;
      setShopper(next);
      return true;
    },
  };
}

/** The alias and tastes as Sara sends them with a question about the trip. */
export const currentShopper = (lang: 'en' | 'es'): Shopper => readShopper(deviceStore(), lang);
