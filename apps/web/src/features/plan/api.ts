import {
  assistantTurnSchema,
  journeySchema,
  type AssistantTurn,
  type Journey,
} from '@moviq/contracts';

import { api, MODEL_TIMEOUT_MS, type ApiClient } from '../../shared/api/client';
import type { Lang } from '../../shared/i18n/lang';

export interface TurnRequest {
  readonly conversationId: string | null;
  readonly message: string;
  readonly lang: Lang;
}

/** The planner's endpoints, each answer validated against its contract. */
function createPlanApi(client: ApiClient) {
  return {
    turn: (body: TurnRequest, signal: AbortSignal): Promise<AssistantTurn> =>
      client.json('/api/assistant/turns', assistantTurnSchema, {
        method: 'POST',
        body,
        signal,
        timeoutMs: MODEL_TIMEOUT_MS,
      }),
    startJourney: (planId: string, itineraryId: string): Promise<Journey> =>
      client.json('/api/journeys', journeySchema, {
        method: 'POST',
        body: { planId, itineraryId },
      }),
  };
}

export type PlanApi = ReturnType<typeof createPlanApi>;

export const planApi = createPlanApi(api);
