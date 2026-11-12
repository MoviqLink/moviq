import { Hono } from 'hono';

import type { OpsBindings } from '../operations/ops-auth.js';
import { recorderStatus, type RecorderStatusDependencies } from './status.js';

/**
 * `GET /api/ops/recorder`, mounted inside the control room routes, behind their session check.
 * It only reads.
 */
export function recorderRoutes(deps: RecorderStatusDependencies): Hono<OpsBindings> {
  const routes = new Hono<OpsBindings>();
  routes.get('/', async (c) => c.json(await recorderStatus(deps)));
  return routes;
}
