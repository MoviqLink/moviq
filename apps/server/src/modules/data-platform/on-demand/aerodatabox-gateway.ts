import { setTimeout as delay } from 'node:timers/promises';

import type { IntegrationState } from '../../../config/integrations.js';
import type { Secret } from '../../../config/secret.js';
import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import type { ProviderOutcome } from '../../journeys/ports.js';
import { PROVIDER } from './aerodatabox-answer.js';
import { MONTHLY_UNITS, type UnitAllowance } from './aerodatabox-units.js';
import { failure, failureFromHttp } from './outcome.js';

/** The RapidAPI gateway of AeroDataBox (OpenAPI 1.15.4.0, `doc.aerodatabox.com`). */
export const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';

/** The free plan allows one request a second; a little more keeps clear of the gateway's edge. */
const SPACING_MS = 1_100;

const TIMEOUT_MS = 15_000;

/** The key, or the variables to set; never a request without the key. */
export type AeroDataBoxCredential =
  { readonly key: Secret } | { readonly missing: readonly string[] };

export function aeroDataBoxCredential(
  integrations: readonly IntegrationState[],
): AeroDataBoxCredential {
  const integration = integrations.find((candidate) => candidate.id === 'aerodatabox');
  if (integration === undefined) return { missing: ['AERODATABOX_KEY'] };
  if (integration.state !== 'configured') return { missing: integration.missing };
  return { key: integration.credentials.AERODATABOX_KEY };
}

export interface AeroDataBoxOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly credential: AeroDataBoxCredential;
  readonly units: UnitAllowance;
  /** Least time between two requests; tests set 0. */
  readonly spacingMs?: number;
}

interface GatewayAnswer {
  readonly status: number;
  readonly body: Uint8Array;
  readonly receivedAt: Date;
}

interface GatewayRequest {
  readonly url: string;
  /** What the endpoint's tier costs. */
  readonly units: number;
  readonly maxBytes: number;
}

/** What `missing-credential` and `monthly-units` say, so each reader can name what it looks up. */
interface GatewayWords {
  readonly lookedUp: string;
}

/**
 * The one way out to AeroDataBox for every reader of the process (flights and airport boards):
 * requests go one at a time, a second apart, and only while the month's units allow them.
 */
export interface AeroDataBoxGateway {
  readonly configured: boolean;
  get(
    request: GatewayRequest,
    words: GatewayWords,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome<GatewayAnswer>>;
}

export function createAeroDataBoxGateway(options: AeroDataBoxOptions): AeroDataBoxGateway {
  const { credential, units, clock } = options;
  const spacingMs = options.spacingMs ?? SPACING_MS;
  let queue: Promise<unknown> = Promise.resolve();
  let lastSent = Number.NEGATIVE_INFINITY;
  return {
    configured: 'key' in credential,
    get(request, words, signal) {
      if (!('key' in credential)) {
        return Promise.resolve(
          failure(
            'misconfigured',
            'missing-credential',
            `Set ${credential.missing.join(', ')} to look up ${words.lookedUp}.`,
          ),
        );
      }
      const run = queue.then(async (): Promise<ProviderOutcome<GatewayAnswer>> => {
        if (!units.take(request.units, clock.now())) return noUnits(units, clock.now(), words);
        const wait = lastSent + spacingMs - Date.now();
        if (wait > 0) await delay(wait);
        lastSent = Date.now();
        try {
          const response = await options.http.get({
            url: request.url,
            headers: {
              accept: 'application/json',
              'x-rapidapi-key': credential.key.reveal(),
              'x-rapidapi-host': AERODATABOX_HOST,
            },
            timeoutMs: TIMEOUT_MS,
            maxBytes: request.maxBytes,
            signal,
          });
          const receivedAt = clock.now();
          units.observe(response.headers, receivedAt);
          return {
            ok: true,
            value: { status: response.status, body: response.body, receivedAt },
            provenance: {
              sourceId: 'aerodatabox',
              dataTime: null,
              receivedAt: receivedAt.toISOString(),
              ageSeconds: null,
              state: 'healthy',
              evidence: `${PROVIDER} answered HTTP ${String(response.status)}.`,
            },
          };
        } catch (error) {
          return failureFromHttp(error, PROVIDER);
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

function noUnits(units: UnitAllowance, now: Date, words: GatewayWords) {
  return failure(
    'rate_limited',
    'monthly-units',
    `${PROVIDER}'s free plan has ${String(units.spendable(now))} of its ${String(MONTHLY_UNITS)} ` +
      `monthly units left above the reserve: ${words.lookedUp} are not looked up until it renews.`,
  );
}
