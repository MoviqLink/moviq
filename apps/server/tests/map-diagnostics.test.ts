import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requestContext, type AppBindings } from '../src/infrastructure/http/context.js';
import { mapDiagnosticsRoutes } from '../src/infrastructure/http/map-diagnostics.js';
import { memoryLogger } from './support/memory-logger.js';

function setup() {
  const logs = memoryLogger();
  const app = new Hono<AppBindings>();
  app.use(requestContext(logs.logger));
  app.route('/api/diagnostics/map', mapDiagnosticsRoutes());
  const send = (body: unknown) =>
    app.request('/api/diagnostics/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=private' },
      body: JSON.stringify(body),
    });
  return { logs, send };
}

describe('browser map diagnostics', () => {
  it('logs only the accepted fields and removes URLs and control characters', async () => {
    const { logs, send } = setup();
    const response = await send({
      kind: 'resource',
      source: 'base',
      message: 'style failed https://example.test/path?private=123\nretry',
    });
    expect(response.status).toBe(204);
    expect(logs.entries().find((entry) => entry['msg'] === 'browser map failure')).toMatchObject({
      kind: 'resource',
      source: 'base',
      message: 'style failed [URL] retry',
    });
    expect(logs.text()).not.toContain('private');
    expect(logs.text()).not.toContain('example.test');
  });

  it('rejects extra, unknown, and oversized fields without writing a diagnostic', async () => {
    const { logs, send } = setup();
    for (const body of [
      { kind: 'resource', source: 'base', message: 'failed', cookie: 'private' },
      { kind: 'other', source: 'base', message: 'failed' },
      { kind: 'timeout', source: 'unknown', message: 'a'.repeat(301) },
    ]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(logs.entries().some((entry) => entry['msg'] === 'browser map failure')).toBe(false);
    expect(logs.text()).not.toContain('private');
  });
});
