import { DatabaseSync } from 'node:sqlite';

import {
  jobListSchema,
  jobSchema,
  liveVehiclesResponseSchema,
  virtualCurrentSchema,
  virtualRideSchema,
} from '@moviq/contracts';
import type { Page } from '@playwright/test';

import { appUrl, expect } from './app.js';
import { JOURNEY } from './captures.js';
import { delayTrain, resetProviderClock } from './provider-control.js';
import { E2E_ADMIN_TOKEN } from './tokens.js';

export const VIRTUAL_BUS_ID = 'bus:MTA NYCT_9767';
export const VIRTUAL_MERCHANT_ID = 'demo-tsuki-ramen-house';
export const VIRTUAL_ITEM_ID = 'tr-miso-vegan';
const VIRTUAL_MERCHANT_DESTINATION = { lat: 40.752732, lon: -73.977218 } as const;

function testDatabase(): DatabaseSync {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  return new DatabaseSync(file, { timeout: 5_000 });
}

/** Put only the demo merchant in this run's throwaway database beside a real M5 stop. */
export function placeVirtualMerchantAt(stop: {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}): void {
  const db = testDatabase();
  try {
    db.prepare(
      `UPDATE commerce_merchants SET lat = ?, lon = ?, stop_id = ?, stop_name = ?,
       stop_lat = ?, stop_lon = ?, stop_routes = ?, walk_minutes = 1 WHERE id = ?`,
    ).run(
      VIRTUAL_MERCHANT_DESTINATION.lat,
      VIRTUAL_MERCHANT_DESTINATION.lon,
      stop.id,
      stop.name,
      stop.lat,
      stop.lon,
      JSON.stringify(['M5']),
      VIRTUAL_MERCHANT_ID,
    );
    const day = [{ opens: '00:00', closes: '24:00' }];
    const week = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
    db.prepare('UPDATE commerce_agent_rules SET hours = ? WHERE merchant_id = ?').run(
      JSON.stringify(week),
      VIRTUAL_MERCHANT_ID,
    );
  } finally {
    db.close();
  }
}

/** Expire one invitation only in this E2E run's throwaway database. */
export function expireVirtualInvitation(id: string): void {
  const db = testDatabase();
  try {
    db.prepare('UPDATE virtual_invitations SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 1_000).toISOString(),
      id,
    );
  } finally {
    db.close();
  }
}

/** Refresh both fixture feeds through the worker; optionally align M5's pickup with the plan capture. */
async function refreshVirtualBus(page: Page, routeCaptureWindow: boolean): Promise<void> {
  const session = await page.request.post(appUrl('/api/ops/session'), {
    data: { token: E2E_ADMIN_TOKEN },
  });
  expect(session.status()).toBe(204);
  const timetableResponse = await page.request.post(
    appUrl('/api/ops/sources/mta-gtfs-bus-manhattan/refresh'),
    { data: { reason: 'virtual ride E2E: refresh captured Manhattan bus timetable' } },
  );
  expect(timetableResponse.status()).toBe(202);
  const timetableJob = jobSchema.parse(await timetableResponse.json());
  await expect
    .poll(
      async () => {
        const jobs = await page.request.get(appUrl('/api/ops/jobs?state=all'));
        return jobListSchema
          .parse(await jobs.json())
          .jobs.find((candidate) => candidate.id === timetableJob.id)?.state;
      },
      { timeout: 30_000 },
    )
    .toBe('done');
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appUrl('/api/live/vehicles?bbox=-74.3,40.4,-73.6,41.0&modes=bus'),
        );
        const live = liveVehiclesResponseSchema.parse(await response.json());
        const source = live.sources.find(
          (item) => item.provenance.sourceId === 'mta-gtfs-bus-manhattan',
        );
        const noLine =
          live.modes
            .find((mode) => mode.mode === 'bus')
            ?.excluded.find((item) => item.reason === 'no-line')?.count ?? 0;
        return source?.provenance.state === 'healthy' && noLine === 0;
      },
      { timeout: 90_000 },
    )
    .toBe(true);

  const clock = await resetProviderClock();
  if (routeCaptureWindow) {
    // The first M5 prediction and the captured route share a real deadline after shifting.
    const firstArrival = clock.shifted('2026-11-11T01:05:19.000Z', '2026-11-11T01:05:15.000Z');
    const pickup = clock.shifted(JOURNEY.capturedAt, JOURNEY.arriveBy);
    const minutes = Math.round(
      (pickup.getTime() - Math.ceil(firstArrival.getTime() / 60_000) * 60_000) / 60_000,
    );
    await delayTrain('gtfsrt.prod.obanyc.com/tripUpdates', {
      routeId: 'M5',
      stopId: '400518',
      plannedAt: clock
        .shifted('2026-11-11T01:05:19.000Z', '2026-11-11T01:06:32.000Z')
        .toISOString(),
      minutes,
    });
  }
  for (const source of ['mta-bus-positions', 'mta-bus-trip-updates']) {
    const response = await page.request.post(appUrl(`/api/ops/sources/${source}/refresh`), {
      data: { reason: 'virtual ride E2E: refresh captured M5 readings' },
    });
    expect(response.status()).toBe(202);
    const job = jobSchema.parse(await response.json());
    await expect
      .poll(
        async () => {
          const jobs = await page.request.get(appUrl('/api/ops/jobs?state=all'));
          return jobListSchema
            .parse(await jobs.json())
            .jobs.find((candidate) => candidate.id === job.id)?.state;
        },
        { timeout: 30_000 },
      )
      .toBe('done');
  }
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appUrl('/api/live/vehicles?bbox=-74.3,40.4,-73.6,41.0&modes=bus'),
        );
        const live = liveVehiclesResponseSchema.parse(await response.json());
        const vehicle = live.vehicles.find((item) => item.id === VIRTUAL_BUS_ID);
        const busMode = live.modes.find((mode) => mode.mode === 'bus');
        const sourceStates = live.sources
          .filter((source) =>
            ['mta-bus-positions', 'mta-bus-trip-updates'].includes(source.provenance.sourceId),
          )
          .map((source) => source.provenance.state);
        const age =
          vehicle === undefined
            ? Number.POSITIVE_INFINITY
            : Date.parse(live.generatedAt) - Date.parse(vehicle.position.dataTime);
        const ready =
          vehicle?.line?.name === 'M5' &&
          vehicle.position.basis === 'gps' &&
          age >= -30_000 &&
          age <= 120_000 &&
          sourceStates.length === 2 &&
          sourceStates.every((state) => state === 'healthy');
        return ready
          ? 'ready'
          : JSON.stringify({
              targetPresent: vehicle !== undefined,
              targetLine: vehicle?.line?.name ?? null,
              basis: vehicle?.position.basis ?? null,
              ageMs: Number.isFinite(age) ? age : null,
              sources: live.sources
                .filter((source) =>
                  ['mta-bus-positions', 'mta-bus-trip-updates'].includes(
                    source.provenance.sourceId,
                  ),
                )
                .map((source) => ({
                  id: source.provenance.sourceId,
                  state: source.provenance.state,
                  dataTime: source.provenance.dataTime,
                  evidence: source.provenance.evidence,
                })),
              busExclusions: busMode?.excluded ?? [],
            });
      },
      { timeout: 30_000 },
    )
    .toBe('ready');
}

/** Starts a real captured M5 ride; `true` offsets its next stop to the existing journey capture. */
export async function boardCapturedM5(page: Page, routeCaptureWindow = false) {
  await refreshVirtualBus(page, routeCaptureWindow);
  const response = await page.request.post(appUrl('/api/virtual/rides'), {
    data: { vehicleId: VIRTUAL_BUS_ID },
  });
  const body: unknown = await response.json();
  const diagnostic =
    response.status() === 201
      ? undefined
      : await page.request
          .get(appUrl('/api/live/vehicles?bbox=-74.3,40.4,-73.6,41.0&modes=bus'))
          .then((result) => result.json())
          .then((value) => liveVehiclesResponseSchema.parse(value))
          .then((live) => ({
            target: live.vehicles.find((vehicle) => vehicle.id === VIRTUAL_BUS_ID),
            busMode: live.modes.find((mode) => mode.mode === 'bus'),
            sources: live.sources.filter((source) =>
              ['mta-bus-positions', 'mta-bus-trip-updates'].includes(source.provenance.sourceId),
            ),
          }));
  expect(response.status(), JSON.stringify({ body, diagnostic })).toBe(201);
  await page.goto(appUrl('/#/explore?view=virtual'));
  return virtualRideSchema.parse(body);
}

export async function currentVirtualRide(page: Page) {
  const response = await page.request.get(appUrl('/api/virtual/rides/current'));
  expect(response.status()).toBe(200);
  return virtualCurrentSchema.parse(await response.json()).ride;
}
