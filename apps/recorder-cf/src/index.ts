import type { Env } from './env.js';

import { auditRoute, authorised, json, statsRoute } from './routes.js';

export { RecorderObject, ReducerObject } from './object.js';

const recorder = (env: Env) => env.RECORDER.get(env.RECORDER.idFromName('recorder'));

/**
 * The Worker: private routes behind `TOKEN_LECTURA` (401 without it) and, every five minutes,
 * a check that the recorder's alarm, and the reducer's while a day waits, are still set.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    if (!authorised(request, env.TOKEN_LECTURA)) return json({ error: 'unauthorised' }, 401);
    const [, first = '', second = ''] = new URL(request.url).pathname.split('/');
    if (first === 'status' && second === '')
      return recorder(env).fetch(new Request('https://recorder/status'));
    if (first === 'stats') return statsRoute(env.RAW, second);
    if (first === 'audit') return auditRoute(env.RAW, second);
    return json({ error: 'not-found' }, 404);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await recorder(env).fetch(new Request('https://recorder/ensure'));
    const reducer = env.REDUCER.get(env.REDUCER.idFromName('nightly'));
    await reducer.fetch(new Request('https://reducer/ensure'));
  },
};
