import { journeySchema, type Journey, type Leg } from '@moviq/contracts';
import type { APIRequestContext, Page } from '@playwright/test';

import { appUrl, expect } from './app.js';
import { JOURNEY } from './captures.js';
import { delayTrain, type TestClock } from './provider-control.js';
import { E2E_ADMIN_TOKEN } from './tokens.js';

const NEW_YORK = 'America/New_York';
/**
 * The feed of that night already runs the 6 of the plan 4 minutes behind the timetable Transitous
 * plans from, so the watch first finds it 4 min late, with 5 min to spare. Grand Central holds it
 * `HELD_MINUTES` more: `LATE_MINUTES` later than planned, with 3 min to spare instead of 9, which
 * the watch reports as at risk.
 */
const HELD_MINUTES = 2;
export const LATE_MINUTES = 6;
export const SUBWAY_SOURCE = 'mta-subway-1234567';

const nyDate = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: NEW_YORK }).format(instant);

/** "10:55 pm", as Sara writes times in English. */
const saraTime = (instant: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: NEW_YORK, hour: 'numeric', minute: '2-digit' })
    .format(instant)
    .toLowerCase();

/** Where the traveller must be and by when, as they would type it. */
function tripRequest(clock: TestClock): string {
  const deadline = clock.shifted(JOURNEY.capturedAt, JOURNEY.arriveBy);
  const day = nyDate(deadline) === nyDate(new Date()) ? '' : ' tomorrow';
  return `I need to be at ${JOURNEY.destination} by ${saraTime(deadline)}${day}`;
}

/** Sends a message and waits for Sara's answer, which must contain `reply`. */
async function tellSara(page: Page, message: string, reply: string): Promise<void> {
  await page.getByLabel('Message for Sara').fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
  const sara = page.getByRole('listitem').filter({ hasText: /^Sara/ }).last();
  await expect(sara).toContainText(reply);
}

/** The journey as the server keeps it, asked as the traveller of this page. */
export async function readJourney(page: Page, id: string): Promise<Journey> {
  const response = await page.request.get(appUrl(`/api/journeys/${id}`));
  expect(response.status()).toBe(200);
  return journeySchema.parse(await response.json());
}

/**
 * The traveller tells Sara where and by when, answers what she asks, sees the plan with the
 * recommended way first and its margin, and starts it. Returns the journey as the server keeps it.
 */
export async function planWithSara(page: Page, clock: TestClock): Promise<Journey> {
  const leave = clock.shifted(JOURNEY.capturedAt, '2026-11-11T07:27:00Z');
  const arrive = clock.shifted(JOURNEY.capturedAt, '2026-11-11T08:08:00Z');
  // The planning conversation lives on its own page; skip the entry page and its introduction.
  await page.addInitScript(() => {
    sessionStorage.setItem('moviq-intro-seen', '1');
  });
  await page.goto(appUrl('/#/plan'));
  await tellSara(
    page,
    tripRequest(clock),
    'Which of these do you mean? 1. 89 EAST 42 STREET, New York, NY, USA; ' +
      '2. 89 EAST 42 STREET, Brooklyn, NY, USA;',
  );
  await tellSara(page, 'the first one', 'Where are you starting from?');
  await tellSara(
    page,
    JOURNEY.origin,
    `Your trip is ready: leave at ${saraTime(leave)} to arrive at ${saraTime(arrive)}, ` +
      'with 9 minutes to spare.',
  );
  const plan = page.getByRole('region', { name: /ways to get there$/ });
  const recommended = plan.getByRole('listitem').first();
  await expect(recommended).toContainText('Recommended');
  await expect(recommended).toContainText('9 min spare');
  await recommended.getByRole('button', { name: 'Start this trip' }).click();
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  return readJourney(page, page.url().split('/').at(-1) ?? '');
}

/** The worker's first verdict replaces "Not checked yet." with its evidence and its age. */
export async function expectWatched(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^89 EAST 42 STREET/);
  await expect(page.getByText(/^· checked .+ ago$/)).toBeVisible({ timeout: 45_000 });
  const verdict = page.getByRole('paragraph').filter({ hasText: /· checked .+ ago$/ });
  await expect(verdict).not.toContainText('Not checked yet.');
  await expect(verdict).toHaveText(/^(On track|Arriving about|No live prediction)/);
}

/** The last part of a Transitous id (`us-ny-MTA-NYCSubway_631S` → `631S`), as the feed names it. */
const feedId = (id: string | null | undefined): string => id?.split('_').at(-1) ?? '';

/** The subway ride of the plan, the one the late train belongs to. */
function subwayRide(planned: Journey): Leg {
  const ride = planned.itinerary.legs.find((leg) => leg.mode === 'subway');
  if (ride === undefined) throw new Error('The recommended trip has no subway ride.');
  return ride;
}

/** Asks the worker to read the subway feed now instead of at its next turn. */
async function refreshSubwayFeed(ops: APIRequestContext): Promise<void> {
  const session = await ops.post(appUrl('/api/ops/session'), { data: { token: E2E_ADMIN_TOKEN } });
  expect(session.status()).toBe(204);
  const refresh = await ops.post(appUrl(`/api/ops/sources/${SUBWAY_SOURCE}/refresh`), {
    data: { reason: 'journey end-to-end: a train of the plan runs late' },
  });
  expect(refresh.status()).toBe(202);
}

/**
 * Holds the 6 of the plan at Grand Central for `HELD_MINUTES` and has the worker read the feed
 * at once, through the control room, with a session of its own (`ops`).
 */
export async function holdTheTrain(planned: Journey, ops: APIRequestContext): Promise<void> {
  const ride = subwayRide(planned);
  await delayTrain(JOURNEY.subwayFeed, {
    routeId: feedId(ride.route?.id),
    stopId: feedId(ride.to.stopId),
    plannedAt: ride.arriveAt,
    minutes: HELD_MINUTES,
  });
  await refreshSubwayFeed(ops);
}
