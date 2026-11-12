import type { CitySource, LiveVehicle } from '@moviq/contracts';

import type { SourceReader } from '../../data-platform/reader.js';
import { byRoute, mtaAlertsIn, pathAlertsIn, type AlertsRead } from './alerts.js';
import type { Finding, HeldTrain, LateBus, LineLive } from './findings.js';
import type { RouteRef } from './lines.js';
import { liveModeOf, liveSourcesOf, modeIsLive, subwayFeedsOf, vehiclesOf } from './live-line.js';
import { sourceOf, type CityPorts } from './ports.js';

/** A bus this far behind its timetable, by Bus Time, is told as late. */
const LATE_SECONDS = 5 * 60;

/** Alerts in force on the line. */
export function lineAlerts(reader: SourceReader, route: RouteRef, now: Date): Promise<AlertsRead> {
  return route.mode === 'path'
    ? pathAlertsIn(reader, route.ids)
    : mtaAlertsIn(reader, now, byRoute(route.mode, route.ids));
}

/**
 * How a line is doing now: its alerts in force, what is seen live (vehicles followed, buses
 * running late by Bus Time, trains held between stations longer than recorded runs, trips
 * cancelled in the MTA feed) and the state of every source it rests on.
 */
export async function lineStatus(ports: CityPorts, route: RouteRef, now: Date): Promise<Finding> {
  const alerts = await lineAlerts(ports.reader, route, now);
  if (route.mode === 'path') {
    return { kind: 'line-status', route, alerts: alerts.list, live: null, sources: alerts.sources };
  }
  const snapshot = await ports.live.snapshot();
  const cancelled = route.mode === 'subway' ? await cancelledTrips(ports.reader, route) : undefined;
  const live = modeIsLive(snapshot, liveModeOf(route))
    ? liveOf(vehiclesOf(snapshot, route), cancelled?.count ?? null)
    : null;
  const sources: CitySource[] = [...alerts.sources, ...liveSourcesOf(snapshot, route)];
  for (const source of cancelled?.sources ?? []) {
    if (!sources.some((known) => known.sourceId === source.sourceId)) sources.push(source);
  }
  return { kind: 'line-status', route, alerts: alerts.list, live, sources };
}

function liveOf(vehicles: readonly LiveVehicle[], cancelled: number | null): LineLive {
  const late: LateBus[] = [];
  const held: HeldTrain[] = [];
  for (const vehicle of vehicles) {
    const destination = vehicle.destination?.name ?? '';
    if (vehicle.delaySeconds !== null && vehicle.delaySeconds >= LATE_SECONDS) {
      late.push({
        name: vehicle.name,
        destination,
        minutes: Math.round(vehicle.delaySeconds / 60),
      });
    }
    const { stall } = vehicle.position;
    if (stall !== null) {
      held.push({
        destination,
        leftStop: stall.leftStop.name,
        elapsedSeconds: stall.elapsedSeconds,
        usualSeconds: stall.usualSeconds,
        n: stall.n,
      });
    }
  }
  late.sort((a, b) => b.minutes - a.minutes);
  return { followed: vehicles.length, late, held, cancelled };
}

/** Trips of the route the MTA feed lists as cancelled; a null count when a feed cannot be read. */
async function cancelledTrips(
  reader: SourceReader,
  route: RouteRef,
): Promise<{ readonly count: number | null; readonly sources: CitySource[] }> {
  const feeds = subwayFeedsOf(route.ids);
  const read = await Promise.all(
    feeds.map(async (definition) => ({ definition, reading: await reader.read(definition) })),
  );
  const usable = read.every(({ reading }) => reading.data !== undefined);
  const count = read.reduce(
    (total, { reading }) =>
      total +
      (reading.data?.trips ?? []).filter(
        (trip) => trip.cancelled && route.ids.includes(trip.routeId),
      ).length,
    0,
  );
  return {
    count: usable && read.length > 0 ? count : null,
    sources: read.map(({ definition, reading }) => sourceOf(definition, reading)),
  };
}
