import { Secret } from './secret.js';

/**
 * Every external service that needs a credential. A credential never blocks the build or the
 * start-up: without it, the integration reports what is missing and its features say so.
 */
export const integrationDefinitions = [
  { id: 'paypal', variables: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] },
  { id: 'paypal-webhooks', variables: ['PAYPAL_WEBHOOK_ID'] },
  { id: 'openai', variables: ['OPENAI_API_KEY'] },
  { id: 'mta-bus-time', variables: ['MTA_BUSTIME_KEY'] },
  { id: 'aerodatabox', variables: ['AERODATABOX_KEY'] },
  { id: 'channel3', variables: ['CHANNEL3_API_KEY'] },
  { id: 'ticketmaster', variables: ['TICKETMASTER_API_KEY'] },
  { id: 'duffel', variables: ['DUFFEL_TOKEN'] },
  { id: 'nlr', variables: ['NLR_API_KEY'] },
  { id: 'moviq-recorder', variables: ['RECORDER_URL', 'RECORDER_READ_TOKEN'] },
  {
    id: 'doordash',
    variables: ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET'],
  },
] as const;

type Definition = (typeof integrationDefinitions)[number];

export type IntegrationId = Definition['id'];

type VariableOf<Id extends IntegrationId> = Extract<Definition, { id: Id }>['variables'][number];

export type IntegrationState<Id extends IntegrationId = IntegrationId> =
  | {
      readonly id: Id;
      readonly state: 'configured';
      readonly credentials: Readonly<Record<VariableOf<Id>, Secret>>;
    }
  | {
      /** `missing`: none of its variables is set. `incomplete`: only some are. */
      readonly id: Id;
      readonly state: 'missing' | 'incomplete';
      readonly missing: readonly VariableOf<Id>[];
    };

export function resolveIntegrations(
  env: Readonly<Record<string, string | undefined>>,
): readonly IntegrationState[] {
  return integrationDefinitions.map((definition) => resolveOne(definition, env));
}

function resolveOne(
  definition: Definition,
  env: Readonly<Record<string, string | undefined>>,
): IntegrationState {
  const present = new Map<string, Secret>();
  const missing: string[] = [];
  for (const variable of definition.variables) {
    const value = env[variable]?.trim();
    if (value === undefined || value === '') missing.push(variable);
    else present.set(variable, new Secret(value));
  }
  // The loop above looked at every variable of this definition, so the record is complete.
  if (missing.length === 0) {
    return {
      id: definition.id,
      state: 'configured',
      credentials: Object.fromEntries(present),
    } as IntegrationState;
  }
  const state = present.size === 0 ? 'missing' : 'incomplete';
  return { id: definition.id, state, missing } as IntegrationState;
}

/** A log-safe summary: names of integrations and of missing variables, never values. */
export function summarizeIntegrations(integrations: readonly IntegrationState[]): {
  readonly configured: readonly string[];
  readonly unavailable: Readonly<Record<string, string>>;
} {
  const configured: string[] = [];
  const unavailable: Record<string, string> = {};
  for (const integration of integrations) {
    if (integration.state === 'configured') configured.push(integration.id);
    else unavailable[integration.id] = `${integration.state}: ${integration.missing.join(', ')}`;
  }
  return { configured, unavailable };
}
