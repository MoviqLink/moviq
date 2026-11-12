import {
  agentDetailSchema,
  agentListSchema,
  roadSegmentsSchema,
  assistantTurnSchema,
  type AgentDetail,
} from '@moviq/contracts';
import { api, MODEL_TIMEOUT_MS } from '../../shared/api/client';
import type { Lang } from '../../shared/i18n/lang';

const path = (id: string) => `/api/agents/${encodeURIComponent(id)}`;
export const agentsApi = {
  list: () => api.json('/api/agents', agentListSchema),
  detail: (id: string): Promise<AgentDetail> => api.json(path(id), agentDetailSchema),
  turn: (id: string, message: string, lang: Lang) =>
    api.json(`${path(id)}/turns`, assistantTurnSchema, {
      method: 'POST',
      body: { message, lang },
      timeoutMs: MODEL_TIMEOUT_MS,
    }),
  /** Empties the conversation; the watches stay. */
  clear: (id: string): Promise<AgentDetail> =>
    api.json(`${path(id)}/messages`, agentDetailSchema, { method: 'DELETE' }),
  watch: (id: string, line: string) =>
    api.json(`${path(id)}/watches`, agentDetailSchema, { method: 'POST', body: { line } }),
  roads: (query: string) =>
    api.json(`/api/agents/roads?q=${encodeURIComponent(query)}`, roadSegmentsSchema),
  watchRoad: (id: string, line: string, segmentId: string, thresholdKmh: number) =>
    api.json(`${path(id)}/watches`, agentDetailSchema, {
      method: 'POST',
      body: { line, kind: 'street', segmentId, thresholdKmh },
    }),
  pause: (id: string, watch: string, paused: boolean) =>
    api.json(`${path(id)}/watches/${encodeURIComponent(watch)}`, agentDetailSchema, {
      method: 'PUT',
      body: { paused },
    }),
  deleteWatch: (id: string, watch: string) =>
    api.send(`${path(id)}/watches/${encodeURIComponent(watch)}`, { method: 'DELETE' }),
};
