import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../../../../../tests/fixtures/paypal/', import.meta.url);

/** The exact text of an official PayPal example (see `tests/fixtures/paypal/README.md`). */
export function fixtureText(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

/** The same example, parsed: still `unknown`, to go through the client's own validation. */
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

/** An official example with some fields replaced, each one named by the test that needs it. */
export function fixtureWith(name: string, fields: Readonly<Record<string, unknown>>): unknown {
  const base = fixture(name);
  if (typeof base !== 'object' || base === null) throw new Error(`${name} is not an object`);
  return { ...base, ...fields };
}
