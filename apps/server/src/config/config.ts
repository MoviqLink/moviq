import { isAbsolute } from 'node:path';

import { z } from 'zod';

import { logLevels, type LogLevel } from '../infrastructure/telemetry/logger.js';
import {
  integrationDefinitions,
  resolveIntegrations,
  type IntegrationState,
} from './integrations.js';
import { Secret } from './secret.js';

type AppEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly appEnv: AppEnv;
  readonly version: string;
  readonly http: { readonly host: string; readonly port: number };
  readonly logLevel: LogLevel;
  readonly database: {
    readonly url: string;
    readonly authToken: Secret | undefined;
  };
  readonly paypalEnv: 'sandbox' | 'live';
  readonly publicDemo: boolean;
  readonly ticketDemoEnabled: boolean;
  readonly paypalDemoBuyerEnabled: boolean;
  /**
   * A sandbox billing agreement the test buyer approved: with the ticket demo on, every demo
   * traveller starts connected to it, so the assistant can pay with no PayPal sign-in.
   */
  readonly paypalDemoAgreementId: string | undefined;
  readonly paypalDemoBuyer: { readonly email: Secret; readonly password: Secret } | undefined;
  readonly adminToken: Secret | undefined;
  /** Read-only access to the control room, for judges and reviewers. */
  readonly viewerToken: Secret | undefined;
  readonly merchantAccessToken: Secret | undefined;
  readonly publicOrigin: string | undefined;
  readonly worker: {
    readonly leaseTtlMs: number;
    readonly heartbeatMs: number;
  };
  readonly recording: {
    /** Where the recorder writes; undefined means it does not run and says so. */
    readonly directory: string | undefined;
    /** Days of raw recording kept; the nightly aggregates are kept for good. */
    readonly retentionDays: number;
  };
  readonly assistant: {
    /** The OpenAI model for Sara and the merchant agent; undefined uses the adapter's default. */
    readonly model: string | undefined;
    /** Tokens the assistants may use per day, all travellers together; then basic mode. */
    readonly dailyTokenBudget: number;
  };
  /** Tests only: every provider request goes to this local origin, which serves captures. */
  readonly testProviderOrigin: string | undefined;
  readonly integrations: readonly IntegrationState[];
}

export type ConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

const DEFAULT_LOCAL_DATABASE = 'file:data/moviq.db';

/** Empty strings count as "not set", so a blank line in `.env` behaves like a missing one. */
const blank = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const oneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: `must be one of: ${values.join(', ')}` });

/** A whole number written in plain decimal digits: no signs, decimals, exponents or hex. */
const wholeNumber = (min: number, max: number, fallback: number, message: string) =>
  z.preprocess(
    blank,
    z
      .string()
      .default(String(fallback))
      .pipe(z.string().regex(/^\d{1,9}$/, { error: message }))
      .transform(Number)
      .pipe(z.number().min(min, { error: message }).max(max, { error: message })),
  );

const wholeSeconds = (min: number, max: number, fallback: number) =>
  wholeNumber(
    min,
    max,
    fallback,
    `must be a whole number of seconds from ${String(min)} to ${String(max)}`,
  );

const envSchema = z.object({
  APP_ENV: z.preprocess(blank, oneOf(['development', 'test', 'production']).default('development')),
  APP_VERSION: z.preprocess(blank, z.string().max(64).default('development')),
  HOST: z.preprocess(blank, z.string().optional()),
  PORT: wholeNumber(1, 65535, 8080, 'must be a whole number from 1 to 65535'),
  LOG_LEVEL: z.preprocess(blank, oneOf(logLevels).default('info')),
  DATABASE_URL: z.preprocess(
    blank,
    z
      .string()
      .regex(/^(file:|libsql:\/\/|https:\/\/)/, {
        error: 'must start with file:, libsql:// or https://',
      })
      .refine((url) => !url.includes(':memory:'), {
        error: 'cannot be an in-memory database: it loses its data on every new connection',
      })
      .optional(),
  ),
  DATABASE_AUTH_TOKEN: z.preprocess(blank, z.string().optional()),
  PAYPAL_ENV: z.preprocess(blank, oneOf(['sandbox', 'live']).default('sandbox')),
  PUBLIC_DEMO: z.preprocess(
    blank,
    oneOf(['true', 'false', '1', '0'])
      .default('false')
      .transform((flag) => flag === 'true' || flag === '1'),
  ),
  TICKET_DEMO_ENABLED: z.preprocess(
    blank,
    oneOf(['true', 'false', '1', '0'])
      .default('false')
      .transform((flag) => flag === 'true' || flag === '1'),
  ),
  PAYPAL_DEMO_BUYER_ENABLED: z.preprocess(
    blank,
    oneOf(['true', 'false', '1', '0'])
      .default('false')
      .transform((flag) => flag === 'true' || flag === '1'),
  ),
  PAYPAL_DEMO_AGREEMENT_ID: z.preprocess(
    blank,
    z
      .string()
      .regex(/^B-[A-Z0-9]{6,40}$/)
      .optional(),
  ),
  PAYPAL_SANDBOX_BUYER_EMAIL: z.preprocess(blank, z.email().max(254).optional()),
  PAYPAL_SANDBOX_BUYER_PASSWORD: z.preprocess(blank, z.string().max(256).optional()),
  ADMIN_TOKEN: z.preprocess(
    blank,
    z.string().min(32, { error: 'must be at least 32 characters long' }).optional(),
  ),
  OPS_VIEWER_TOKEN: z.preprocess(
    blank,
    z.string().min(32, { error: 'must be at least 32 characters long' }).optional(),
  ),
  MERCHANT_ACCESS_TOKEN: z.preprocess(blank, z.string().min(32).max(256).optional()),
  PUBLIC_ORIGIN: z.preprocess(
    blank,
    z
      .url()
      .refine(
        (value) => {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            url.origin === value &&
            url.username === '' &&
            url.password === ''
          );
        },
        { error: 'must be an HTTP(S) origin without a path or credentials' },
      )
      .optional(),
  ),
  TEST_PROVIDER_ORIGIN: z.preprocess(
    blank,
    z
      .string()
      .regex(/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/, {
        error: 'must be http://127.0.0.1:<port> or http://localhost:<port>',
      })
      .optional(),
  ),
  OPENAI_MODEL: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,63}$/, {
        error: 'must be a model name such as gpt-6-luna',
      })
      .optional(),
  ),
  ASSISTANT_DAILY_TOKEN_BUDGET: wholeNumber(
    0,
    50_000_000,
    200_000,
    'must be a whole number of tokens up to 50000000',
  ),
  WORKER_LEASE_TTL_SECONDS: wholeSeconds(3, 300, 30),
  WORKER_HEARTBEAT_SECONDS: wholeSeconds(1, 3600, 30),
  RECORDING_DIR: z.preprocess(
    blank,
    z.string().refine(isAbsolute, { error: 'must be an absolute path' }).optional(),
  ),
  RECORDING_RETENTION_DAYS: wholeNumber(1, 90, 7, 'must be a whole number of days from 1 to 90'),
});

type ParsedEnv = z.infer<typeof envSchema>;

/** Every environment variable the server reads, so `.env.example` can be checked against it. */
export function configVariableNames(): readonly string[] {
  return [
    ...Object.keys(envSchema.shape),
    ...integrationDefinitions.flatMap((definition) => definition.variables),
  ];
}

/**
 * Validates the environment once, at start-up. Problems name the variable and the rule, never
 * the value. Integration credentials are optional and never make start-up fail.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`),
    };
  }
  const integrations = resolveIntegrations(env);
  const problems = crossRules(parsed.data, integrations);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: build(parsed.data, integrations) };
}

/** Every credential in the configuration, so the logger can keep their values out of its output. */
export function configSecrets(config: AppConfig): readonly Secret[] {
  const secrets: Secret[] = [];
  if (config.adminToken !== undefined) secrets.push(config.adminToken);
  if (config.viewerToken !== undefined) secrets.push(config.viewerToken);
  if (config.merchantAccessToken !== undefined) secrets.push(config.merchantAccessToken);
  if (config.database.authToken !== undefined) secrets.push(config.database.authToken);
  if (config.paypalDemoBuyer !== undefined)
    secrets.push(config.paypalDemoBuyer.email, config.paypalDemoBuyer.password);
  for (const integration of config.integrations) {
    if (integration.state === 'configured') secrets.push(...Object.values(integration.credentials));
  }
  return secrets;
}

function crossRules(env: ParsedEnv, integrations: readonly IntegrationState[]): string[] {
  const problems: string[] = [];
  if (env.APP_ENV === 'production') {
    if (env.ADMIN_TOKEN === undefined) problems.push('ADMIN_TOKEN is required in production');
    if (env.DATABASE_URL === undefined) problems.push('DATABASE_URL is required in production');
    else if (env.DATABASE_URL.startsWith('file:') && !env.DATABASE_URL.startsWith('file:/')) {
      problems.push('DATABASE_URL must be remote or an absolute file path in production');
    }
  }
  if (env.OPS_VIEWER_TOKEN !== undefined && env.OPS_VIEWER_TOKEN === env.ADMIN_TOKEN) {
    problems.push('OPS_VIEWER_TOKEN must differ from ADMIN_TOKEN');
  }
  if (env.TEST_PROVIDER_ORIGIN !== undefined && env.APP_ENV !== 'test') {
    problems.push('TEST_PROVIDER_ORIGIN is only allowed with APP_ENV=test');
  }
  if (env.TICKET_DEMO_ENABLED && env.PAYPAL_ENV !== 'sandbox')
    problems.push('TICKET_DEMO_ENABLED requires PAYPAL_ENV=sandbox');
  if (env.PAYPAL_DEMO_AGREEMENT_ID !== undefined && !env.TICKET_DEMO_ENABLED)
    problems.push('PAYPAL_DEMO_AGREEMENT_ID requires TICKET_DEMO_ENABLED=true');
  if (env.PAYPAL_ENV === 'live') {
    if (env.APP_ENV !== 'production') problems.push('PAYPAL_ENV=live requires APP_ENV=production');
    if (env.PUBLIC_DEMO) problems.push('PAYPAL_ENV=live cannot run with PUBLIC_DEMO');
    const paypal = integrations.find((integration) => integration.id === 'paypal');
    if (paypal?.state !== 'configured') {
      problems.push('PAYPAL_ENV=live requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
    }
  }
  return problems;
}

function build(env: ParsedEnv, integrations: readonly IntegrationState[]): AppConfig {
  const local = env.APP_ENV !== 'production';
  return {
    appEnv: env.APP_ENV,
    version: env.APP_VERSION,
    http: {
      host: env.HOST ?? (local ? '127.0.0.1' : '0.0.0.0'),
      port: env.PORT,
    },
    logLevel: env.LOG_LEVEL,
    database: {
      url: env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE,
      authToken:
        env.DATABASE_AUTH_TOKEN === undefined ? undefined : new Secret(env.DATABASE_AUTH_TOKEN),
    },
    paypalEnv: env.PAYPAL_ENV,
    publicDemo: env.PUBLIC_DEMO,
    ticketDemoEnabled: env.TICKET_DEMO_ENABLED,
    paypalDemoBuyerEnabled: env.PAYPAL_DEMO_BUYER_ENABLED,
    paypalDemoAgreementId: env.PAYPAL_DEMO_AGREEMENT_ID,
    paypalDemoBuyer:
      env.PAYPAL_SANDBOX_BUYER_EMAIL !== undefined &&
      env.PAYPAL_SANDBOX_BUYER_PASSWORD !== undefined
        ? {
            email: new Secret(env.PAYPAL_SANDBOX_BUYER_EMAIL),
            password: new Secret(env.PAYPAL_SANDBOX_BUYER_PASSWORD),
          }
        : undefined,
    publicOrigin: env.PUBLIC_ORIGIN,
    merchantAccessToken:
      env.MERCHANT_ACCESS_TOKEN === undefined ? undefined : new Secret(env.MERCHANT_ACCESS_TOKEN),
    adminToken: env.ADMIN_TOKEN === undefined ? undefined : new Secret(env.ADMIN_TOKEN),
    viewerToken: env.OPS_VIEWER_TOKEN === undefined ? undefined : new Secret(env.OPS_VIEWER_TOKEN),
    worker: {
      leaseTtlMs: env.WORKER_LEASE_TTL_SECONDS * 1000,
      heartbeatMs: env.WORKER_HEARTBEAT_SECONDS * 1000,
    },
    recording: {
      directory: env.RECORDING_DIR,
      retentionDays: env.RECORDING_RETENTION_DAYS,
    },
    assistant: {
      model: env.OPENAI_MODEL,
      dailyTokenBudget: env.ASSISTANT_DAILY_TOKEN_BUDGET,
    },
    testProviderOrigin: env.TEST_PROVIDER_ORIGIN,
    integrations,
  };
}
