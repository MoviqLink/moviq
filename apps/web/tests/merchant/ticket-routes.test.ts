import { describe, expect, it } from 'vitest';

import { merchantHref, parseMerchantPath, sectionOf } from '../../src/features/merchant/routes';

describe('merchant ticket sales route', () => {
  it('opens the aggregate sales dashboard inside the existing merchant session panel', () => {
    const route = parseMerchantPath(['ticket-sales']);
    expect(route).toEqual({ name: 'ticket-sales' });
    expect(merchantHref['ticket-sales']).toBe('#/merchant/ticket-sales');
    expect(sectionOf(route)).toBe('ticket-sales');
  });

  it('rejects an unknown dashboard subpath', () => {
    expect(parseMerchantPath(['ticket-sales', 'traveller'])).toEqual({ name: 'not-found' });
  });
});
