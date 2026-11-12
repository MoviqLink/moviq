import type { AirportProgram, Journey, LiveStation, PlanResponse } from '@moviq/contracts';

import type { CitySnapshot } from '../../live/city.js';
import {
  byAgency,
  byStation,
  ferryAlertsIn,
  mtaAlertsIn,
  pathAlertsIn,
  type AlertsRead,
} from './alerts.js';
import type { AlertFact, Finding, Unanswered } from './findings.js';
import { lineAlerts } from './line-status.js';
import { citySources, modeIsLive } from './live-line.js';
import { routeOf, type CityMode, type RouteRef } from './lines.js';
import { watchedJourney, type CityPorts } from './ports.js';
import { readStations } from './station-access.js';

export type IncidentScope =
  | { readonly scope: 'line'; readonly route: RouteRef }
  | { readonly scope: 'station'; readonly station: string }
  | { readonly scope: 'mode'; readonly mode: CityMode }
  | { readonly scope: 'trip' };

interface TripContext {
  readonly travellerId: string;
  /** The plan of the conversation, when the traveller has no trip under watch. */
  readonly plan: PlanResponse | null;
}

/** Incidents in force on a line, at a station, in a mode or along the traveller's trip. */
export async function incidents(
  ports: CityPorts,
  asked: IncidentScope,
  now: Date,
  trip: TripContext,
): Promise<Finding | Unanswered> {
  switch (asked.scope) {
    case 'line': {
      const read = await lineAlerts(ports.reader, asked.route, now);
      return { ...finding(asked.route.label, 'line', null, read, null), route: asked.route };
    }
    case 'station': {
      const stations = await readStations(ports, asked.station);
      if (!('named' in stations)) return stations;
      const ids = stations.named.map((station) => station.id);
      const read = await mtaAlertsIn(ports.reader, now, byStation(ids));
      const outages = stations.facts.flatMap((fact) => fact.outagesNow ?? []);
      const known = stations.facts.every((fact) => fact.outagesNow !== null);
      const subject = stations.facts.length === 1 ? (stations.facts[0]?.name ?? '') : asked.station;
      return {
        ...finding(subject, 'station', null, read, known ? outages : null),
        sources: [...read.sources, ...stations.sources],
      };
    }
    case 'mode':
      return finding(
        asked.mode,
        'mode',
        asked.mode,
        await modeAlerts(ports, asked.mode, now),
        null,
      );
    case 'trip':
      return tripIncidents(ports, now, trip);
  }
}

function finding(
  subject: string,
  scope: 'line' | 'station' | 'mode' | 'trip',
  mode: CityMode | null,
  read: AlertsRead,
  outages: Extract<Finding, { kind: 'incidents' }>['outages'],
): Extract<Finding, { kind: 'incidents' }> {
  const { list, sources } = read;
  return { kind: 'incidents', subject, scope, route: null, mode, alerts: list, outages, sources };
}

async function modeAlerts(ports: CityPorts, mode: CityMode, now: Date): Promise<AlertsRead> {
  switch (mode) {
    case 'subway':
    case 'bus':
    case 'rail':
      return mtaAlertsIn(ports.reader, now, byAgency(mode));
    case 'path':
      return pathAlertsIn(ports.reader, undefined);
    case 'ferry':
      return ferryAlertsIn(ports.reader, now);
    case 'airports':
      return airportPrograms(await ports.live.snapshot());
  }
}

type Airport = Extract<LiveStation, { mode: 'airport' }>;

/** The FAA programs in force at JFK, LaGuardia and Newark, as Explore holds them. */
function airportPrograms(snapshot: CitySnapshot): AlertsRead {
  const ids = snapshot.modes.find((summary) => summary.mode === 'airport')?.sourceIds ?? [];
  const sources = citySources(snapshot, ids);
  if (!modeIsLive(snapshot, 'airport')) return { list: { alerts: null, aged: true }, sources };
  const airports = snapshot.stations.filter(
    (station): station is Airport => station.mode === 'airport',
  );
  const alerts = airports.flatMap((airport) =>
    airport.programs.map((program) => ({
      text: `${airport.code}: ${programText(program)}`,
      since: null,
      until: null,
    })),
  );
  const aged = sources.some((source) => source.state !== 'healthy' && source.state !== 'degraded');
  return { list: { alerts, aged }, sources };
}

/** The FAA program in its own words. */
function programText(program: AirportProgram): string {
  const reason = program.reason === null ? '' : ` Reason: ${program.reason}.`;
  switch (program.kind) {
    case 'ground-stop':
      return `ground stop${program.until === null ? '' : ` until ${program.until}`}.${reason}`;
    case 'ground-delay':
      return `ground delay program${program.average === null ? '' : `, average ${program.average.text}`}.${reason}`;
    case 'delay':
      return `${program.direction} delays${program.maximum === null ? '' : ` up to ${program.maximum.text}`}.${reason}`;
    case 'closure':
      return `closed${program.reopens === null ? '' : ` until ${program.reopens}`}.${reason}`;
  }
}

/** Alerts on the lines of the trip under watch, or of the plan, and what its watch found. */
async function tripIncidents(
  ports: CityPorts,
  now: Date,
  trip: TripContext,
): Promise<Finding | Unanswered> {
  const journey = await watchedJourney(ports.db, trip.travellerId);
  const itinerary = journey?.itinerary ?? recommended(trip.plan);
  if (itinerary === undefined) return { kind: 'no-trip' };
  const routes = itinerary.legs.flatMap((leg) => {
    const route = leg.route === null ? undefined : routeOf(leg.route.shortName);
    return route === undefined || route.mode === 'path' ? [] : [route];
  });
  const subway = routes.filter((route) => route.mode === 'subway').flatMap((route) => route.ids);
  const bus = routes.filter((route) => route.mode === 'bus').flatMap((route) => route.ids);
  const read = await mtaAlertsIn(
    ports.reader,
    now,
    (affected) =>
      affected.routeId !== null &&
      ((byAgency('subway')(affected) && subway.includes(affected.routeId)) ||
        (byAgency('bus')(affected) && bus.includes(affected.routeId))),
  );
  const watched = watchIncidents(journey);
  const alerts = read.list.alerts === null ? null : [...watched, ...read.list.alerts];
  const labels = routes.map((route) => route.label).join(', ');
  return {
    ...finding(labels === '' ? 'trip' : labels, 'trip', null, read, null),
    alerts: { alerts, aged: read.list.aged },
  };
}

const recommended = (plan: PlanResponse | null) =>
  plan?.itineraries.find((itinerary) => itinerary.id === plan.recommendedId);

/** What the watch of the trip found, newest first, as it wrote it. */
function watchIncidents(journey: Journey | undefined): AlertFact[] {
  return [...(journey?.incidents ?? [])]
    .reverse()
    .map((incident) => ({ text: incident.evidence, since: incident.at, until: null }));
}
