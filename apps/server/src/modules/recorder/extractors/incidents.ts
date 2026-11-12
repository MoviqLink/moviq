import {
  faaAirportStatusSource,
  type NewYorkAirportStatus,
} from '../../data-platform/sources/city/faa-airport-status.js';
import {
  nwsAlertsSource,
  type NewYorkWeatherAlerts,
} from '../../data-platform/sources/city/nws-alerts.js';
import { mtaAlerts, type AlertsFeed } from '../../data-platform/sources/mta/alerts.js';
import { mtaElevators, type ElevatorOutages } from '../../data-platform/sources/mta/elevators.js';
import { unixSeconds } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';
import { createLifecycle, fingerprintOf, type IncidentItem } from './lifecycle.js';

type ServiceAlert = AlertsFeed['alerts'][number];

/** Incidents span days: their sessions carry on and only a restart reads the registry again. */
const ACROSS_DAYS = { mode: null, restartsDaily: false } as const;

/**
 * The MTA leaves cause and effect out today, but its alert ids say what an alert is:
 * `lmm:alert:…` for service alerts and `lmm:planned_work:…` for planned work.
 */
function alertType(alert: ServiceAlert): string {
  if (alert.effect !== null) return alert.effect;
  if (alert.cause !== null) return alert.cause;
  if (alert.id.startsWith('lmm:planned_work:')) return 'planned-work';
  if (alert.id.startsWith('lmm:alert:')) return 'service-alert';
  return 'unclassified';
}

/** An alert counts while one of its periods covers the time of the data, or it has none. */
function activeAt(alert: ServiceAlert, at: number): boolean {
  if (alert.activePeriods.length === 0) return true;
  return alert.activePeriods.some(
    (period) =>
      (period.start === null || unixSeconds(period.start) <= at) &&
      (period.end === null || unixSeconds(period.end) > at),
  );
}

const transitAlerts = extractorFor(mtaAlerts, ACROSS_DAYS, (open) =>
  createLifecycle<AlertsFeed>(open, (data, at) =>
    data.alerts
      .filter((alert) => activeAt(alert, at))
      .map((alert): IncidentItem => ({
        id: alert.id,
        kind: 'transit-alert',
        type: alertType(alert),
        routes: alert.affected.flatMap((entity) => entity.routeId ?? []),
        fingerprint: fingerprintOf([alert.header, alert.activePeriods, alert.affected]),
      })),
  ),
);

/** Outages under way; announced ones count only once they start. */
const elevatorOutages = extractorFor(mtaElevators, ACROSS_DAYS, (open) =>
  createLifecycle<ElevatorOutages>(open, (data) =>
    data.outages
      .filter((outage) => !outage.upcoming)
      .map((outage) => ({
        id: outage.equipmentId,
        kind: outage.kind,
        type: outage.maintenance ? 'maintenance' : 'outage',
        routes: outage.lines,
        fingerprint: fingerprintOf([outage.reason, outage.estimatedReturn, outage.since]),
      })),
  ),
);

/** Each FAA programme at a New York airport: ground stops, ground delays, delays, closures. */
const airportPrograms = extractorFor(faaAirportStatusSource, ACROSS_DAYS, (open) =>
  createLifecycle<NewYorkAirportStatus>(open, (data) =>
    data.airports.flatMap((airport) =>
      airport.programs.map((program) => ({
        id: `${airport.code}:${program.kind}${program.kind === 'delay' ? `:${program.direction}` : ''}`,
        kind: 'airport',
        type: program.kind,
        routes: [airport.code],
        fingerprint: fingerprintOf(program),
      })),
    ),
  ),
);

/** National Weather Service alerts for New York while their hazard is under way. */
const weatherAlerts = extractorFor(nwsAlertsSource, ACROSS_DAYS, (open) =>
  createLifecycle<NewYorkWeatherAlerts>(open, (data, at) =>
    data.alerts
      .filter(
        (alert) =>
          unixSeconds(alert.startsAt) <= at && unixSeconds(alert.endsAt ?? alert.expiresAt) > at,
      )
      .map((alert) => ({
        id: alert.id,
        kind: 'weather',
        type: alert.event,
        routes: [],
        fingerprint: fingerprintOf([alert.severity, alert.headline, alert.endsAt, alert.expiresAt]),
      })),
  ),
);

export const incidentExtractors: readonly Extractor[] = [
  transitAlerts,
  elevatorOutages,
  airportPrograms,
  weatherAlerts,
];
