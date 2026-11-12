import { describe, expect, it } from 'vitest';

import { ticketCatalog } from '../../server/src/modules/tickets/catalog.js';
import {
  DEMO_NOTICE,
  DEMO_NOTICE_ES,
  informationText,
  localizationIds,
  localizedNotice,
  productText,
} from '../src/features/tickets/localization';

describe('ticket Spanish localization', () => {
  it('covers every current product and information entry while preserving English API fallback', () => {
    const catalog = ticketCatalog();
    expect(localizationIds.products.toSorted()).toEqual(
      catalog.products.map(({ id }) => id).toSorted(),
    );
    expect(localizationIds.information.toSorted()).toEqual(
      catalog.information.map(({ id }) => id).toSorted(),
    );
    expect(productText('future-product', 'Future fare', 'Server description', 'es')).toEqual({
      name: 'Future fare',
      description: 'Server description',
    });
    expect(informationText('future-service', 'Future service', 'Server terms', 'es')).toEqual({
      name: 'Future service',
      description: 'Server terms',
    });
  });

  it('localizes the known demo notice and leaves unknown notices intact', () => {
    expect(localizedNotice(DEMO_NOTICE, 'es')).toBe(DEMO_NOTICE_ES);
    expect(localizedNotice(DEMO_NOTICE, 'en')).toBe(DEMO_NOTICE);
    expect(localizedNotice('New server notice', 'es')).toBe('New server notice');
  });
});
