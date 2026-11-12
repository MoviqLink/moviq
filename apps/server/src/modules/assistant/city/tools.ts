import { z } from 'zod';

import { fromNewYorkWallClockText } from '../../../infrastructure/clock/new-york.js';

import type { ActionAnswer } from '../planning/actions.js';
import type { Turn } from '../planning/state.js';
import { defineTool, type AssistantTool } from '../planning/tool.js';
import { askCity } from './ask.js';
import { CITY_MODES, routeOf, type RouteRef } from './lines.js';

const ROUTE = z.string().trim().min(1).max(40);
const NAME = z.string().trim().min(2).max(80);
const LOCAL_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/;

/** The route named, or the reply says it is not one MovIQ reads. */
function known(turn: Turn, said: string, run: (route: RouteRef) => Promise<ActionAnswer>) {
  const route = routeOf(said);
  if (route !== undefined) return run(route);
  turn.city.push({ kind: 'unknown-route', said });
  return Promise.resolve({ error: `No line called "${said}" is known.` });
}

/**
 * The city tools: everything they answer comes from the data platform with its source and the
 * time of its data; a source that could not be read comes back as null, never as "none".
 */
export const cityTools: readonly AssistantTool[] = [
  defineTool(
    'line_status',
    'How a subway line, bus route or PATH is doing now: alerts in force, vehicles followed ' +
      'live, buses late, trains held, trips cancelled, and each source with its state.',
    z.strictObject({ route: ROUTE }),
    (input, ports, turn) =>
      known(turn, input.route, (route) => askCity(ports, turn, { tool: 'line-status', route })),
  ),
  defineTool(
    'incidents',
    'Incidents in force on a line (route), at a subway station (station, with its elevator ' +
      'outages), in a mode (mode), or along the trip the traveller is on (scope trip).',
    z.strictObject({
      scope: z.enum(['line', 'station', 'mode', 'trip']),
      route: ROUTE.nullable(),
      station: NAME.nullable(),
      mode: z.enum(CITY_MODES).nullable(),
    }),
    (input, ports, turn) => {
      if (input.scope === 'line') {
        return known(turn, input.route ?? '', (route) =>
          askCity(ports, turn, { tool: 'incidents', scope: { scope: 'line', route } }),
        );
      }
      if (input.scope === 'station' && input.station !== null) {
        const scope = { scope: 'station', station: input.station } as const;
        return askCity(ports, turn, { tool: 'incidents', scope });
      }
      if (input.scope === 'mode' && input.mode !== null) {
        const scope = { scope: 'mode', mode: input.mode } as const;
        return askCity(ports, turn, { tool: 'incidents', scope });
      }
      if (input.scope === 'trip') {
        return askCity(ports, turn, { tool: 'incidents', scope: { scope: 'trip' } });
      }
      return Promise.resolve({ error: `Scope ${input.scope} needs its ${input.scope} field.` });
    },
  ),
  defineTool(
    'where_is',
    'Where vehicles are now, as followed live: of a route, optionally towards a destination; ' +
      'one vehicle by its fleet number; or the next ride of the traveller trip (my_trip).',
    z.strictObject({
      route: ROUTE.nullable(),
      towards: NAME.nullable(),
      vehicle: z
        .string()
        .trim()
        .regex(/^\d{3,5}$/)
        .nullable(),
      my_trip: z.boolean(),
    }),
    (input, ports, turn) => {
      if (input.my_trip) return askCity(ports, turn, { tool: 'where-is', asked: { by: 'trip' } });
      if (input.vehicle !== null) {
        const asked = { by: 'vehicle', name: input.vehicle } as const;
        return askCity(ports, turn, { tool: 'where-is', asked });
      }
      return known(turn, input.route ?? '', (route) =>
        askCity(ports, turn, {
          tool: 'where-is',
          asked: { by: 'route', route, towards: input.towards },
        }),
      );
    },
  ),
  defineTool(
    'station_access',
    'Elevators and escalators of a subway station: out of service now and announced, and ' +
      'step-free access by direction. Use the station name as the traveller said it.',
    z.strictObject({ station: NAME }),
    (input, ports, turn) =>
      askCity(ports, turn, { tool: 'station-access', station: input.station }),
  ),
  defineTool(
    'line_reliability',
    'How a line usually runs, from the recorder: intervals, bunching and stoppages, ' +
      'with counts and the day measured. local_time is New York YYYY-MM-DDTHH:mm, or null for now.',
    z.strictObject({ route: ROUTE, local_time: z.string().regex(LOCAL_TIME).nullable() }),
    (input, ports, turn) => {
      const at =
        input.local_time === null
          ? turn.now
          : fromNewYorkWallClockText(`${input.local_time}:00.000`);
      if (at === undefined)
        return Promise.resolve({ error: 'That time does not exist in New York.' });
      return known(turn, input.route, (route) =>
        askCity(ports, turn, { tool: 'line-reliability', route, at }),
      );
    },
  ),
  defineTool(
    'restrooms_near',
    'Free public restrooms in service near the next stops of the traveller trip (near trip), a ' +
      'subway station (near stop, with its name) or a place or address (near place, with it): ' +
      'straight-line distance and hours as the city publishes them.',
    z.strictObject({ near: z.enum(['trip', 'stop', 'place']), name: NAME.nullable() }),
    (input, ports, turn) => {
      if (input.near === 'trip') {
        return askCity(ports, turn, { tool: 'restrooms', near: { by: 'trip' } });
      }
      if (input.name === null) {
        return Promise.resolve({ error: `near ${input.near} needs its name.` });
      }
      return askCity(ports, turn, {
        tool: 'restrooms',
        near: { by: input.near, name: input.name },
      });
    },
  ),
];
