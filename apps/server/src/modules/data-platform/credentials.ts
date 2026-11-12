import type { IntegrationState } from '../../config/integrations.js';
import type { CredentialResolver } from './collector.js';
import type { SourceDefinition } from './definition.js';

/**
 * Credentials of each source from the configured integrations: the names of missing variables,
 * and the revealed values, handed over only to build the request.
 */
export function credentialsFrom(integrations: readonly IntegrationState[]): {
  readonly resolve: CredentialResolver;
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
} {
  const byId = new Map(integrations.map((integration) => [integration.id, integration]));
  const resolve: CredentialResolver = (definition) => {
    if (definition.integration === undefined) return { missing: [], values: {} };
    const integration = byId.get(definition.integration);
    if (integration === undefined) return { missing: [definition.integration], values: {} };
    if (integration.state !== 'configured') return { missing: integration.missing, values: {} };
    const values = Object.fromEntries(
      Object.entries(integration.credentials).map(([name, secret]) => [name, secret.reveal()]),
    );
    return { missing: [], values };
  };
  return { resolve, missingVariables: (definition) => resolve(definition).missing };
}
