import { describe, expect, it } from 'vitest';

import { parseMerchantPath, merchantHref } from '../../src/features/merchant/routes';
import { merchantEn, merchantEs } from '../../src/features/merchant/texts';

function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}: function/${String(value.length)}`];
  if (typeof value === 'string') return [`${path}: string`];
  if (typeof value !== 'object' || value === null) return [`${path}: ${typeof value}`];
  return Object.entries(value).flatMap(([key, child]) =>
    shape(child, path === '' ? key : `${path}.${key}`),
  );
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(strings);
}

describe('the merchant panel', () => {
  it('has the same words in English and Spanish, none empty', () => {
    expect(shape(merchantEs).sort()).toEqual(shape(merchantEn).sort());
    for (const text of [...strings(merchantEn), ...strings(merchantEs)]) {
      expect(text.trim()).not.toBe('');
    }
  });

  it('opens each screen by its address, Today at the bare one', () => {
    const route = (href: string) => parseMerchantPath(href.split('/').slice(2));
    expect(parseMerchantPath([])).toEqual({ name: 'today' });
    expect(route(merchantHref.requests)).toEqual({ name: 'requests', threadId: null });
    expect(route(merchantHref.request('a b'))).toEqual({ name: 'requests', threadId: 'a b' });
    for (const name of ['tickets', 'scan', 'customers', 'payouts', 'agent'] as const) {
      expect(route(merchantHref[name])).toEqual({ name });
    }
    expect(parseMerchantPath(['today'])).toEqual({ name: 'today' });
  });

  it('says not found for anything else', () => {
    expect(parseMerchantPath(['tickets', 'x'])).toEqual({ name: 'not-found' });
    expect(parseMerchantPath(['requests', '%E0%A4%A'])).toEqual({ name: 'not-found' });
    expect(parseMerchantPath(['requests', 'a', 'b'])).toEqual({ name: 'not-found' });
    expect(parseMerchantPath(['orders'])).toEqual({ name: 'not-found' });
  });
});
