import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  configSecrets,
  configVariableNames,
  loadConfig,
  type AppConfig,
} from '../src/config/config.js';
import { Secret } from '../src/config/secret.js';
import { createLogger } from '../src/infrastructure/telemetry/logger.js';
import { commerceVariableNames } from '../src/modules/commerce/settings.js';

const STRONG_TOKEN = 'a'.repeat(32);

function expectConfig(env: Record<string, string>): AppConfig {
  const result = loadConfig(env);
  if (!result.ok) throw new Error(`expected a valid configuration: ${result.problems.join('; ')}`);
  return result.config;
}

function expectProblems(env: Record<string, string>): readonly string[] {
  const result = loadConfig(env);
  if (result.ok) throw new Error('expected a configuration error');
  return result.problems;
}

describe('loadConfig', () => {
  it('starts with no variables at all: local defaults and no credentials', () => {
    const config = expectConfig({});
    expect(config).toMatchObject({
      appEnv: 'development',
      http: { host: '127.0.0.1', port: 8080 },
      logLevel: 'info',
      database: { url: 'file:data/moviq.db', authToken: undefined },
      paypalEnv: 'sandbox',
      publicDemo: false,
      adminToken: undefined,
    });
    expect(config.integrations.every((integration) => integration.state === 'missing')).toBe(true);
  });

  it('treats blank values as not set', () => {
    const config = expectConfig({ PORT: '  ', APP_ENV: '', OPENAI_API_KEY: ' ' });
    expect(config.http.port).toBe(8080);
    expect(config.appEnv).toBe('development');
    expect(config.integrations.find((i) => i.id === 'openai')?.state).toBe('missing');
  });

  it('rejects malformed values and names the variable, never the value', () => {
    const problems = expectProblems({
      PORT: '99999',
      APP_ENV: 'staging-secret-word',
      PUBLIC_DEMO: 'yes',
      DATABASE_URL: 'postgres://user:pass@host/db',
    });
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toContain('PORT must be a whole number from 1 to 65535');
    expect(problems.join(' ')).toContain('APP_ENV must be one of: development, test, production');
    for (const value of ['staging-secret-word', 'user:pass', '99999', 'yes']) {
      expect(problems.join(' ')).not.toContain(value);
    }
  });

  it('accepts only whole numbers written in plain digits (regression)', () => {
    for (const port of ['0x50', '1e3', '8080.0', '+80', '-1', '0b11']) {
      expect(expectProblems({ PORT: port })).toEqual([
        'PORT must be a whole number from 1 to 65535',
      ]);
    }
    expect(expectConfig({ PORT: '0080' }).http.port).toBe(80);
    expect(expectProblems({ WORKER_HEARTBEAT_SECONDS: '1.5' })).toEqual([
      'WORKER_HEARTBEAT_SECONDS must be a whole number of seconds from 1 to 3600',
    ]);
    expect(expectConfig({ WORKER_LEASE_TTL_SECONDS: '9' }).worker).toEqual({
      leaseTtlMs: 9_000,
      heartbeatMs: 30_000,
    });
  });

  it('refuses an in-memory database, and a relative file path in production (regression)', () => {
    expect(expectProblems({ DATABASE_URL: 'file::memory:' })).toEqual([
      'DATABASE_URL cannot be an in-memory database: it loses its data on every new connection',
    ]);
    const production = { APP_ENV: 'production', ADMIN_TOKEN: STRONG_TOKEN };
    expect(expectProblems({ ...production, DATABASE_URL: 'file:data/moviq.db' })).toEqual([
      'DATABASE_URL must be remote or an absolute file path in production',
    ]);
    expect(
      expectConfig({ ...production, DATABASE_URL: 'file:/var/lib/moviq/moviq.db' }).appEnv,
    ).toBe('production');
  });

  it('allows redirecting providers to local captures only in tests', () => {
    expect(expectProblems({ TEST_PROVIDER_ORIGIN: 'http://127.0.0.1:9000' })).toEqual([
      'TEST_PROVIDER_ORIGIN is only allowed with APP_ENV=test',
    ]);
    expect(
      expectProblems({ APP_ENV: 'test', TEST_PROVIDER_ORIGIN: 'https://evil.example' }),
    ).toEqual(['TEST_PROVIDER_ORIGIN must be http://127.0.0.1:<port> or http://localhost:<port>']);
    const config = expectConfig({ APP_ENV: 'test', TEST_PROVIDER_ORIGIN: 'http://127.0.0.1:9000' });
    expect(config.testProviderOrigin).toBe('http://127.0.0.1:9000');
  });

  it('reads the assistant model and its daily token budget', () => {
    expect(expectConfig({}).assistant).toEqual({ model: undefined, dailyTokenBudget: 200_000 });
    expect(
      expectConfig({ OPENAI_MODEL: 'gpt-5-mini', ASSISTANT_DAILY_TOKEN_BUDGET: '0' }).assistant,
    ).toEqual({
      model: 'gpt-5-mini',
      dailyTokenBudget: 0,
    });
    expect(expectProblems({ OPENAI_MODEL: 'GPT 5!' })).toEqual([
      'OPENAI_MODEL must be a model name such as gpt-6-luna',
    ]);
  });

  it('requires a viewer token different from the admin token', () => {
    expect(expectProblems({ ADMIN_TOKEN: STRONG_TOKEN, OPS_VIEWER_TOKEN: STRONG_TOKEN })).toEqual([
      'OPS_VIEWER_TOKEN must differ from ADMIN_TOKEN',
    ]);
  });

  it('requires an admin token of at least 32 characters when one is given', () => {
    expect(expectProblems({ ADMIN_TOKEN: 'short' })).toEqual([
      'ADMIN_TOKEN must be at least 32 characters long',
    ]);
  });

  it('requires ADMIN_TOKEN and an explicit DATABASE_URL in production', () => {
    expect(expectProblems({ APP_ENV: 'production' })).toEqual([
      'ADMIN_TOKEN is required in production',
      'DATABASE_URL is required in production',
    ]);
    const config = expectConfig({
      APP_ENV: 'production',
      ADMIN_TOKEN: STRONG_TOKEN,
      DATABASE_URL: 'libsql://example.turso.io',
    });
    expect(config.http.host).toBe('0.0.0.0');
  });

  it('refuses live PayPal outside production, with the public demo or without credentials', () => {
    expect(expectProblems({ PAYPAL_ENV: 'live', PUBLIC_DEMO: 'true' })).toEqual([
      'PAYPAL_ENV=live requires APP_ENV=production',
      'PAYPAL_ENV=live cannot run with PUBLIC_DEMO',
      'PAYPAL_ENV=live requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET',
    ]);
  });

  it('accepts live PayPal only with production, an admin token and both PayPal credentials', () => {
    const config = expectConfig({
      APP_ENV: 'production',
      ADMIN_TOKEN: STRONG_TOKEN,
      DATABASE_URL: 'libsql://example.turso.io',
      PAYPAL_ENV: 'live',
      PAYPAL_CLIENT_ID: 'client',
      PAYPAL_CLIENT_SECRET: 'secret',
    });
    expect(config.paypalEnv).toBe('live');
  });

  it('opts the ticket demo in explicitly and rejects live PayPal', () => {
    expect(expectConfig({}).ticketDemoEnabled).toBe(false);
    expect(expectConfig({}).paypalDemoBuyerEnabled).toBe(false);
    expect(expectConfig({ PAYPAL_DEMO_BUYER_ENABLED: 'true' }).paypalDemoBuyer).toBeUndefined();
    expect(expectConfig({ TICKET_DEMO_ENABLED: 'true' }).ticketDemoEnabled).toBe(true);
    expect(expectProblems({ TICKET_DEMO_ENABLED: 'true', PAYPAL_ENV: 'live' })).toContain(
      'TICKET_DEMO_ENABLED requires PAYPAL_ENV=sandbox',
    );
  });

  it('accepts the public demo with sandbox PayPal', () => {
    expect(expectConfig({ PUBLIC_DEMO: '1' }).publicDemo).toBe(true);
  });
});

describe('integration credentials never block start-up', () => {
  it('reports missing, incomplete and configured integrations by variable name', () => {
    const config = expectConfig({
      PAYPAL_CLIENT_ID: 'client-id-value',
      OPENAI_API_KEY: 'openai-key-value',
      DOORDASH_DEVELOPER_ID: 'dev',
      DOORDASH_SIGNING_SECRET: 'signing',
    });
    const byId = new Map(config.integrations.map((integration) => [integration.id, integration]));
    expect(byId.get('openai')?.state).toBe('configured');
    expect(byId.get('paypal')).toEqual({
      id: 'paypal',
      state: 'incomplete',
      missing: ['PAYPAL_CLIENT_SECRET'],
    });
    expect(byId.get('doordash')).toEqual({
      id: 'doordash',
      state: 'incomplete',
      missing: ['DOORDASH_KEY_ID'],
    });
    expect(byId.get('duffel')).toEqual({
      id: 'duffel',
      state: 'missing',
      missing: ['DUFFEL_TOKEN'],
    });
  });

  it('keeps every credential behind a Secret that never prints its value', () => {
    const config = expectConfig({ OPENAI_API_KEY: 'openai-key-value', ADMIN_TOKEN: STRONG_TOKEN });
    const openai = config.integrations.find((integration) => integration.id === 'openai');
    if (openai?.state !== 'configured') throw new Error('openai should be configured');
    expect(openai.credentials.OPENAI_API_KEY.reveal()).toBe('openai-key-value');
    const printed = [
      JSON.stringify(config),
      inspect(config, { depth: 10 }),
      String(config.adminToken),
    ];
    for (const text of printed) {
      expect(text).not.toContain('openai-key-value');
      expect(text).not.toContain(STRONG_TOKEN);
    }
  });
});

describe('Secret', () => {
  it('reveals its value only on request', () => {
    const secret = new Secret('value');
    expect(secret.reveal()).toBe('value');
    expect(`${secret.toString()}|${JSON.stringify({ secret })}|${inspect(secret)}`).toBe(
      '[redacted]|{"secret":"[redacted]"}|[redacted]',
    );
  });
});

describe('.env.example', () => {
  it('lists exactly the variables the server reads, all of them without a credential value', () => {
    const example = readFileSync(
      fileURLToPath(new URL('../../../.env.example', import.meta.url)),
      'utf8',
    );
    const listed = example
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => line.slice(0, line.indexOf('=')));
    expect([...listed].sort()).toEqual(
      [...configVariableNames(), ...commerceVariableNames()].sort(),
    );
    expect(expectConfig({}).integrations.length).toBeGreaterThan(0);
  });
});

describe('configSecrets', () => {
  it('hands every credential of the configuration to the logger, which then hides them', () => {
    const config = expectConfig({
      ADMIN_TOKEN: STRONG_TOKEN,
      DATABASE_AUTH_TOKEN: 'database-auth-token',
      OPENAI_API_KEY: 'openai-key-value',
    });
    const values = configSecrets(config).map((secret) => secret.reveal());
    expect([...values].sort()).toEqual(
      [STRONG_TOKEN, 'database-auth-token', 'openai-key-value'].sort(),
    );
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      sink: (line) => lines.push(line),
      secrets: configSecrets(config),
    });
    logger.error('failed', {
      error: new Error(`rejected database-auth-token and ${STRONG_TOKEN}`),
    });
    expect(lines.join('')).not.toMatch(/database-auth-token|a{32}/);
  });
});
