import { productFeatureSchema, sourceStateSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { en } from '../src/shared/i18n/en';
import { es } from '../src/shared/i18n/es';

/** Every leaf of a dictionary as `path: kind`, where a function also records how many arguments. */
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

describe('translations', () => {
  it('have the same keys, each of the same kind, in English and Spanish', () => {
    expect(shape(es).sort()).toEqual(shape(en).sort());
  });

  it('name every source state and every product feature of the contracts', () => {
    for (const dict of [en, es]) {
      expect(Object.keys(dict.states).sort()).toEqual([...sourceStateSchema.options].sort());
      expect(Object.keys(dict.productFeatures).sort()).toEqual(
        [...productFeatureSchema.options].sort(),
      );
    }
  });

  it('leave no text empty', () => {
    for (const text of [...strings(en), ...strings(es)]) expect(text.trim()).not.toBe('');
  });

  it('give every state a different word in each language', () => {
    for (const dict of [en, es]) {
      const labels = Object.values(dict.states).map((state) => state.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
