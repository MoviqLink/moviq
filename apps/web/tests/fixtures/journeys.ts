import type {
  Alternative,
  AssistantTurn,
  Flight,
  FlightCheck,
  Incident,
  Journey,
  Payment,
  PaymentsConfig,
  PlanRequest,
  PlanResponse,
} from '@moviq/contracts';

import { HOME, TERMINAL, type Lang } from './geography';
import {
  busItinerary,
  iso,
  q70Itinerary,
  min,
  provenance,
  scene,
  subwayItinerary,
  taxiItinerary,
} from './itineraries';

// Test doubles for the traveller's API: shaped by the contracts, never used by the product. Every
// time is an offset from `now`, so ages and margins read the same whenever the review runs.

export { scene };

const say = (lang: Lang, en: string, es: string) => (lang === 'es' ? es : en);

function flight(now: number): Flight {
  const { deadline } = scene(now);
  return {
    carrier: 'AA',
    number: '2215',
    departureAt: iso(deadline + 100 * min),
    revisedDeparture: null,
    takeOffAt: null,
    airport: 'LGA',
    terminal: 'B',
    gate: null,
    status: 'Expected',
    callSign: 'AAL2215',
    aircraftHex: 'a1b2c3',
    provenance: provenance(now, 'aerodatabox', 300, 'AeroDataBox lists AA 2215 departing LGA.'),
  };
}

/** New York wall-clock time, `18:25`, as the server writes it in its sentences. */
const clock = (at: number) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);

/**
 * The watch's last check of the flight: AeroDataBox moved it 20 min later, so the deadline moved
 * too. With `pass`, the trip was planned from the boarding pass, which still says the old time.
 */
function flightCheck(now: number, pass: boolean): FlightCheck {
  const { deadline } = scene(now);
  const revised = deadline + 120 * min;
  const aerodatabox: Flight = {
    ...flight(now),
    revisedDeparture: { at: iso(revised), kind: 'revised' },
    gate: 'B12',
    status: 'Delayed',
    provenance: provenance(now, 'aerodatabox', 95, 'AeroDataBox lists AA 2215 departing LGA.'),
  };
  return {
    aerodatabox,
    departure: { at: iso(revised), basis: 'revised', sourceId: 'aerodatabox' },
    movement: null,
    evidence: `Planned from AA 2215's revised departure, ${clock(revised)} (AeroDataBox).`,
    discrepancies: pass
      ? [
          `Your boarding pass says ${clock(deadline + 100 * min)}; AeroDataBox says ` +
            `${clock(revised)} (revised).`,
        ]
      : [],
    readings: [
      {
        sourceId: 'aerodatabox',
        says:
          `Scheduled ${clock(deadline + 100 * min)}, revised ${clock(revised)}, terminal B, ` +
          'gate B12, status Delayed.',
        provenance: aerodatabox.provenance,
      },
      {
        sourceId: 'faa-airport-status',
        says: 'No FAA delay programme at LGA.',
        provenance: provenance(now, 'faa-airport-status', 60, 'Data is 60 s old.'),
      },
    ],
  };
}

/** The flight as the traveller read it from the boarding pass. */
function passFlight(now: number): Flight {
  return {
    ...flight(now),
    gate: null,
    status: null,
    callSign: null,
    provenance: {
      sourceId: 'boarding-pass',
      dataTime: null,
      receivedAt: iso(now - 10 * min),
      ageSeconds: null,
      state: 'healthy',
      evidence: 'The traveller read the departure on the boarding pass.',
    },
  };
}

export function plan(now: number, lang: Lang): PlanResponse {
  return {
    planId: 'plan-1',
    generatedAt: iso(now),
    itineraries: [subwayItinerary(now, lang), busItinerary(now, lang)],
    recommendedId: 'it-m60',
    notices: [],
  };
}

/** Sara's turns: asking for the missing origin, then complete with the plan. */
export function turns(now: number, lang: Lang) {
  const { deadline } = scene(now);
  const asking: AssistantTurn = {
    conversationId: 'conv-1',
    mode: 'ai',
    reply: say(
      lang,
      'LaGuardia Terminal B before your 10:00 flight, got it. Where will you leave from?',
      'Terminal B de LaGuardia antes de tu vuelo, entendido. ¿Desde dónde sales?',
    ),
    draft: { origin: null, destination: TERMINAL, arriveBy: iso(deadline), flight: flight(now) },
    missing: ['origin'],
    plan: null,
    city: [],
  };
  const complete: AssistantTurn = {
    conversationId: 'conv-1',
    mode: 'basic',
    reply: say(
      lang,
      'Two ways get you there in time. The M60 bus is the one I recommend: it is ' +
        'running live and leaves you 38 minutes to spare.',
      'Hay dos formas de llegar a tiempo. Te recomiendo el bus M60: va en directo y te deja 38 minutos de margen.',
    ),
    draft: { origin: HOME, destination: TERMINAL, arriveBy: iso(deadline), flight: flight(now) },
    missing: [],
    plan: plan(now, lang),
    city: [],
  };
  return { asking, complete };
}

function trafficIncident(now: number, lang: Lang): Incident {
  return {
    id: 'inc-rfk',
    at: iso(now - 90_000),
    legIndex: 1,
    kind: 'traffic',
    evidence: say(
      lang,
      'Traffic on the RFK Bridge is moving at 6 mph; it usually moves at 28 mph.',
      'El tráfico en el puente RFK avanza a 10 km/h; lo normal son 45 km/h.',
    ),
    provenance: provenance(now, 'nyc-dot-traffic', 60, 'NYC DOT real-time speeds, link 4616.'),
    impactMinutes: 31,
  };
}

function alternatives(now: number, lang: Lang): Alternative[] {
  return [
    {
      id: 'alt-q70',
      itinerary: q70Itinerary(now),
      recommended: false,
      why: say(
        lang,
        'Change at Astoria Blvd to the Q70, which does not cross the RFK Bridge.',
        'Cambia en Astoria Blvd al Q70, que no cruza el puente RFK.',
      ),
      price: null,
    },
    {
      id: 'alt-taxi',
      itinerary: taxiItinerary(now),
      recommended: true,
      why: say(
        lang,
        'Get off at Astoria Blvd; a partner taxi takes the Grand Central Pkwy, which is clear.',
        'Bájate en Astoria Blvd; un taxi asociado va por la Grand Central Pkwy, que está despejada.',
      ),
      price: { amountMinor: 2140, currency: 'USD' },
    },
  ];
}

/**
 * A journey being watched: on track, or at risk with its incident and alternatives. `projected`
 * says whether the worker has projected the arrival yet.
 */
export function journey(now: number, lang: Lang, risk: boolean, projected = true): Journey {
  const { start } = scene(now);
  const request: PlanRequest = {
    origin: HOME,
    destination: TERMINAL,
    arriveBy: iso(scene(now).deadline),
    preferences: {
      maxWalkMinutes: 15,
      stepFree: false,
      modes: ['walk', 'bus', 'subway'],
      spareMinutes: 10,
    },
    flight: risk ? passFlight(now) : flight(now),
  };
  return {
    id: risk ? 'trip-risk' : 'trip-ok',
    state: 'watching',
    request,
    itinerary: busItinerary(now, lang),
    createdAt: iso(now - 4 * min),
    watch: risk
      ? {
          status: 'at-risk',
          evaluatedAt: iso(now - 40_000),
          projectedArriveAt: projected ? iso(start + 76 * min) : null,
          evidence: say(
            lang,
            'At 6 mph the M60 reaches Terminal B 7 minutes before you must be there.',
            'A 10 km/h el M60 llega a la Terminal B 7 minutos antes de la hora límite.',
          ),
          flight: flightCheck(now, true),
          stepFreeRefusal: null,
        }
      : {
          status: 'on-track',
          evaluatedAt: iso(now - 40_000),
          projectedArriveAt: projected ? iso(start + 45 * min) : null,
          evidence: say(
            lang,
            'The M60-SBS is 4 minutes from Lexington Av, as planned.',
            'El M60-SBS está a 4 minutos de Lexington Av, como estaba previsto.',
          ),
          flight: flightCheck(now, false),
          stepFreeRefusal: null,
        },
    incidents: risk ? [trafficIncident(now, lang)] : [],
    alternatives: risk ? alternatives(now, lang) : [],
  };
}

/** The journey once the free Q70 alternative is taken: the server answers with it applied. */
export function applied(now: number, lang: Lang, id: string): Journey {
  const before = journey(now, lang, true);
  const itinerary = q70Itinerary(now);
  return {
    ...before,
    id,
    itinerary,
    watch: {
      status: 'on-track',
      evaluatedAt: iso(now),
      projectedArriveAt: itinerary.arriveAt,
      evidence: say(
        lang,
        'You are on the new route: the Q70 avoids the RFK Bridge.',
        'Vas por la nueva ruta: el Q70 evita el puente RFK.',
      ),
      flight: before.watch.flight,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}

export const paymentsConfig: PaymentsConfig = {
  available: true,
  clientId: 'sandbox-client-for-tests',
  environment: 'sandbox',
  currency: 'USD',
};

export const paymentsOff: PaymentsConfig = {
  available: false,
  reason: 'PayPal credentials are not configured on this server.',
};

/** The order the server creates for the taxi alternative, and the same order once captured. */
export function payment(now: number, status: Payment['status']): Payment {
  return {
    id: 'pay-1',
    paypalOrderId: '5O190127TN364715T',
    status,
    amount: { amountMinor: 2140, currency: 'USD' },
    description: 'Partner taxi from Astoria Blvd to LaGuardia Terminal B',
    purpose: { kind: 'journey-alternative', journeyId: 'trip-risk', alternativeId: 'alt-taxi' },
    createdAt: iso(now - 20_000),
    updatedAt: iso(now),
  };
}
