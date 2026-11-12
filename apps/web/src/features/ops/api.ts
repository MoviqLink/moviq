import {
  auditListSchema,
  jobListSchema,
  jobSchema,
  moneyInDoubtSchema,
  opsSessionSchema,
  opsSummarySchema,
  sourceDetailSchema,
  sourceListSchema,
  type Job,
  type JobFilter,
  type OpsSession,
} from '@moviq/contracts';

import { api, type ApiClient } from '../../shared/api/client';
import { ApiRequestError } from '../../shared/api/errors';

/** The control room endpoints, each answer validated against its contract. */
export function createOpsApi(client: ApiClient) {
  return {
    /** The open session, or null when there is none (the API answers 401). */
    async session(signal: AbortSignal): Promise<OpsSession | null> {
      try {
        return await client.json('/api/ops/session', opsSessionSchema, { signal });
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'unauthorized') return null;
        throw error;
      }
    },
    signIn: (token: string) => client.send('/api/ops/session', { method: 'POST', body: { token } }),
    signOut: () => client.send('/api/ops/session', { method: 'DELETE' }),
    summary: (signal: AbortSignal) => client.json('/api/ops/summary', opsSummarySchema, { signal }),
    sources: (signal: AbortSignal) => client.json('/api/ops/sources', sourceListSchema, { signal }),
    source: (id: string, signal: AbortSignal) =>
      client.json(`/api/ops/sources/${encodeURIComponent(id)}`, sourceDetailSchema, { signal }),
    refresh: (id: string, reason: string): Promise<Job> =>
      client.json(`/api/ops/sources/${encodeURIComponent(id)}/refresh`, jobSchema, {
        method: 'POST',
        body: { reason },
      }),
    jobs: (filter: JobFilter, signal: AbortSignal) =>
      client.json(`/api/ops/jobs?state=${filter}`, jobListSchema, { signal }),
    cancel: (id: number, reason: string): Promise<Job> =>
      client.json(`/api/ops/jobs/${String(id)}/cancel`, jobSchema, {
        method: 'POST',
        body: { reason },
      }),
    audit: (signal: AbortSignal) => client.json('/api/ops/audit', auditListSchema, { signal }),
    money: (signal: AbortSignal) => client.json('/api/ops/money', moneyInDoubtSchema, { signal }),
  };
}

export const opsApi = createOpsApi(api);
