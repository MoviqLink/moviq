import { localTime, type ActionAnswer, type PlanningPorts } from '../planning/actions.js';
import type { Turn } from '../planning/state.js';
import { incidents, type IncidentScope } from './incidents.js';
import { lineStatus } from './line-status.js';
import type { RouteRef } from './lines.js';
import { lineReliability } from './reliability.js';
import { restroomsNearFinding, type RestroomsAsked } from './restrooms.js';
import { stationAccess } from './station-access.js';
import { whereIs } from './where-is.js';
import type { CityResult } from './words.js';

/** A question about the city, as the model's tools or the basic reader understood it. */
export type CityQuestion =
  | { readonly tool: 'line-status'; readonly route: RouteRef }
  | { readonly tool: 'incidents'; readonly scope: IncidentScope }
  | {
      readonly tool: 'where-is';
      readonly asked:
        | { readonly by: 'route'; readonly route: RouteRef; readonly towards: string | null }
        | { readonly by: 'vehicle'; readonly name: string }
        | { readonly by: 'trip' };
    }
  | { readonly tool: 'station-access'; readonly station: string }
  | { readonly tool: 'line-reliability'; readonly route: RouteRef; readonly at: Date }
  | { readonly tool: 'restrooms'; readonly near: RestroomsAsked };

/** At most this many city answers in one turn, as the contract allows. */
const MAX_RESULTS = 4;

/**
 * Answers a city question from the data platform, keeps the result for the reply and the cards,
 * and gives the model the same facts with New York times.
 */
export async function askCity(
  ports: PlanningPorts,
  turn: Turn,
  question: CityQuestion,
): Promise<ActionAnswer> {
  if (turn.city.length >= MAX_RESULTS) {
    return { error: 'Enough has been looked up this turn: answer with what the tools gave.' };
  }
  const result = await answer(ports, turn, question);
  turn.city.push(result);
  return forModel(result);
}

function answer(ports: PlanningPorts, turn: Turn, question: CityQuestion): Promise<CityResult> {
  const { city } = ports;
  const trip = { travellerId: turn.travellerId, plan: turn.state.plan };
  switch (question.tool) {
    case 'line-status':
      return lineStatus(city, question.route, turn.now);
    case 'incidents':
      return incidents(city, question.scope, turn.now, trip);
    case 'where-is':
      return whereIs(
        city,
        question.asked.by === 'trip' ? { by: 'trip', ...trip } : question.asked,
        turn.now,
      );
    case 'station-access':
      return stationAccess(city, question.station);
    case 'line-reliability':
      return lineReliability(city, question.route, question.at);
    case 'restrooms': {
      const restroomPorts = { city, geocoder: ports.geocoder, signal: turn.signal };
      return restroomsNearFinding(restroomPorts, question.near, trip, turn.now);
    }
  }
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** The result as the model reads it: every instant as New York local time. */
function forModel(result: CityResult): ActionAnswer {
  const text = JSON.stringify(result, (_, value: unknown) =>
    typeof value === 'string' && INSTANT.test(value) ? localTime(new Date(value)) : value,
  );
  const parsed: unknown = JSON.parse(text);
  return { result: parsed };
}
