import { z } from 'zod';

import { REWARD_TOOLS, runRewardTool } from '../../commerce/sara-tools.js';
import { cityTools } from '../city/tools.js';
import type { ToolCall, ToolResult, ToolSpec } from '../model/language-model.js';
import { arrivalFrom } from '../understanding/time-words.js';
import {
  choosePlace,
  findPlace,
  planSummary,
  setArrival,
  settlePlan,
  type ActionAnswer,
  type PlanningPorts,
} from './actions.js';
import { fillBoardingPass, findFlight } from './flight-actions.js';
import { MAX_CANDIDATES, type Turn } from './state.js';
import { stopTools } from './stopover.js';
import { ticketTools } from './ticket-tools.js';
import { defineTool, type AssistantTool } from './tool.js';
import { watchTools } from './watch-tools.js';

/**
 * The tools the model may ask for: planning, the city, then the rewards on a trip's way. The plan
 * is made by Sara as soon as the draft is complete, and its summary goes back with that call's
 * result.
 */

const slotSchema = z.enum(['origin', 'destination']);
const LOCAL_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/;

const PLANNING_TOOLS: readonly AssistantTool[] = [
  defineTool(
    'find_place',
    'Looks up a place in New York for the destination or the start. With one clear match it ' +
      'is chosen; with several, the numbered options come back to offer.',
    z.strictObject({ slot: slotSchema, query: z.string().min(2).max(120) }),
    (input, ports, turn) => findPlace(ports, turn, input.slot, input.query),
  ),
  defineTool(
    'choose_place',
    'Chooses one of the numbered places offered for a slot, once the traveller says which.',
    z.strictObject({ slot: slotSchema, option: z.number().int().min(1).max(MAX_CANDIDATES) }),
    (input, _, turn) => Promise.resolve(choosePlace(turn, input.slot, input.option)),
  ),
  defineTool(
    'find_flight',
    'Looks up a flight leaving New York by its IATA airline code (upper case) and number. The ' +
      'date is the New York departure date, or null for the next departure. The flight sets ' +
      'the airport and the time to be there.',
    z.strictObject({
      carrier: z.string().regex(/^[A-Z0-9]{2,3}$/),
      number: z.string().regex(/^\d{1,4}$/),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
    (input, ports, turn) =>
      findFlight(ports, turn, { carrier: input.carrier, number: input.number, date: input.date }),
  ),
  defineTool(
    'set_boarding_pass',
    'Sets the flight find_flight could not give from its boarding pass: the departure time ' +
      'printed on it as New York local time YYYY-MM-DDTHH:mm (24-hour), its airport, and the ' +
      'terminal or null when the traveller does not know it.',
    z.strictObject({
      local_time: z.string().regex(LOCAL_TIME),
      airport: z.enum(['JFK', 'LGA', 'EWR']),
      terminal: z
        .string()
        .regex(/^[A-Z0-9]{1,3}$/)
        .nullable(),
    }),
    (input, ports, turn) => {
      const [day = '', time = ''] = input.local_time.split('T');
      const [hour = 0, minute = 0] = time.split(':').map(Number);
      return fillBoardingPass(ports, turn, {
        clock: { hour, minute, half: 'h24' },
        day,
        airport: input.airport,
        terminal: input.terminal ?? undefined,
      });
    },
  ),
  defineTool(
    'set_arrival',
    'Sets when the traveller must arrive, as New York local time YYYY-MM-DDTHH:mm (24-hour). Not for flights.',
    z.strictObject({ local_time: z.string().regex(LOCAL_TIME) }),
    (input, _, turn) => {
      const [day = '', time = ''] = input.local_time.split('T');
      const [hour = 0, minute = 0] = time.split(':').map(Number);
      return Promise.resolve(
        setArrival(turn, arrivalFrom({ hour, minute, half: 'h24' }, day, turn.now)),
      );
    },
  ),
];

const TOOLS: readonly AssistantTool[] = [
  ...PLANNING_TOOLS,
  ...cityTools,
  ...stopTools,
  ...ticketTools,
  ...watchTools,
];

export const planningToolSpecs: readonly ToolSpec[] = [
  ...TOOLS.map((tool) => tool.spec),
  ...REWARD_TOOLS,
];

const REWARD_NAMES = new Set(REWARD_TOOLS.map((tool) => tool.name));

/** Rewards are asked of the merchants on a trip under watch: while planning there is none yet. */
const NO_TRIP = JSON.stringify({
  error: 'Rewards are offered on a trip under watch: start the trip first, then ask on its screen.',
});

/** Runs the calls in order; once the draft is complete, the plan goes back with the call. */
export async function runToolCalls(
  calls: readonly ToolCall[],
  ports: PlanningPorts,
  turn: Turn,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) {
    if (REWARD_NAMES.has(call.name)) {
      if (ports.rewards === undefined) results.push({ callId: call.callId, output: NO_TRIP });
      else results.push(await runRewardTool(call, ports.rewards));
      continue;
    }
    const output = await runOne(call, ports, turn);
    results.push({ callId: call.callId, output: JSON.stringify(output) });
  }
  return results;
}

async function runOne(call: ToolCall, ports: PlanningPorts, turn: Turn): Promise<ActionAnswer> {
  const tool = TOOLS.find((candidate) => candidate.spec.name === call.name);
  if (tool === undefined) {
    ports.logger.warn('assistant tool call rejected', { tool: call.name.slice(0, 64) });
    return { rejected: 'There is no tool with that name.' };
  }
  const outcome = await tool.run(call.arguments, ports, turn);
  if (!outcome.ok) {
    ports.logger.warn('assistant tool call rejected', { tool: call.name, issues: outcome.issues });
    return { rejected: 'The arguments do not match the schema.', issues: outcome.issues };
  }
  const plan = await settlePlan(ports, turn);
  return plan === null ? outcome.answer : { ...outcome.answer, plan: planSummary(plan) };
}
