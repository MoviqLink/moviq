import type { Bucket } from './ports.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRIVATE = { 'cache-control': 'private, no-store' } as const;

/** Compares two keys in a time that does not depend on where they differ. */
export function sameKey(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1)
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

/** True when the request carries `Authorization: Bearer <TOKEN_LECTURA>`. */
export function authorised(request: Request, token: string | undefined): boolean {
  if (token === undefined || token === '') return false;
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && sameKey(header.slice(7), token);
}

export const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...PRIVATE, 'content-type': 'application/json; charset=utf-8' },
  });

const text = (value: string, status = 200): Response =>
  new Response(value, {
    status,
    headers: { ...PRIVATE, 'content-type': 'text/plain; charset=utf-8' },
  });

/** `GET /stats/latest` and `GET /stats/<day>`: the published JSON, as stored. */
export async function statsRoute(bucket: Bucket, name: string): Promise<Response> {
  if (name !== 'latest' && !DAY.test(name)) return json({ error: 'not-found' }, 404);
  const stored = await bucket.get(`stats/${name}.json`);
  if (stored === null) return json({ error: 'not-reduced-yet' }, 404);
  return new Response(await stored.text(), {
    headers: { ...PRIVATE, 'content-type': 'application/json; charset=utf-8' },
  });
}

/** `GET /audit/<day>`: the audit lines of a New York day, hour by hour, as text. */
export async function auditRoute(bucket: Bucket, day: string): Promise<Response> {
  if (!DAY.test(day)) return text('Not a day.\n', 404);
  const listed = await bucket.list({ prefix: `audit/${day}/` });
  const keys = listed.objects.map((object) => object.key).sort();
  if (keys.length === 0) return text(`Nothing was recorded on ${day} yet.\n`, 404);
  const parts = await Promise.all(
    keys.map(async (key) => `# ${key.slice(6)}\n${(await (await bucket.get(key))?.text()) ?? ''}`),
  );
  return text(parts.join(''));
}
