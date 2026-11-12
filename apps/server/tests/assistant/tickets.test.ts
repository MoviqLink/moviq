import type { Leg, PlanResponse, Provenance } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import type { PlanningPorts } from '../../src/modules/assistant/planning/actions.js';
import { emptyState, type Turn } from '../../src/modules/assistant/planning/state.js';
import { ticketTools } from '../../src/modules/assistant/planning/ticket-tools.js';
import { ticketReply } from '../../src/modules/assistant/planning/ticket-words.js';
import { productOf } from '../../src/modules/tickets/catalog.js';
import { memoryLogger } from '../support/memory-logger.js';
import { BRYANT_PARK, HARLEM_ACBD } from './doubles.js';

const SUBWAY = productOf('omny-single-demo');
const BUS = productOf('omny-local-bus-demo');
if (SUBWAY === undefined || BUS === undefined) throw new Error('missing products');

describe("Sara's words about tickets", () => {
  it('tell a purchase with every ticket, the total, where it was paid and the PayPal order', () => {
    const note = {
      kind: 'bought',
      receipts: [
        {
          bought: true,
          ticketId: 't-1',
          product: SUBWAY,
          paidWith: 'paypal',
          paypalOrderId: 'ORDER1',
        },
        {
          bought: true,
          ticketId: 't-2',
          product: SUBWAY,
          paidWith: 'wallet',
          paypalOrderId: null,
        },
      ],
    } as const;
    const english = ticketReply(note, 'en');
    expect(english).toContain('Done. I bought 2 × OMNY single ride ($3.00 each) and paid $6.00');
    expect(english).toContain('from your trip wallet and with your PayPal');
    expect(english).toContain('PayPal order: ORDER1.');
    const spanish = ticketReply(note, 'es');
    expect(spanish).toContain('Hecho. He comprado 2 × OMNY single ride (3,00 $ cada uno)');
    expect(spanish).toContain('he pagado 6,00 $ de tu billetera de viaje y con tu PayPal');
    expect(spanish).toContain('Pedido de PayPal: ORDER1.');
  });

  it('say what was not bought, and that it was not charged', () => {
    const note = {
      kind: 'bought',
      receipts: [{ bought: false, product: BUS, reason: 'PayPal did not confirm.' }],
    } as const;
    expect(ticketReply(note, 'en')).toBe(
      'I could not buy 1 × MTA local bus single ($3.00): PayPal did not confirm it and that was not charged.',
    );
    expect(ticketReply(note, 'es')).toContain('No he podido comprar 1 × MTA local bus single');
  });

  it('give each refusal its own words in English and Spanish', () => {
    const refused = (reason: 'switched-off' | 'no-funds' | 'no-fare') => ({
      en: ticketReply({ kind: 'refused', reason }, 'en'),
      es: ticketReply({ kind: 'refused', reason }, 'es'),
    });
    expect(refused('switched-off').en).toContain('Let Sara buy tickets for me');
    expect(refused('switched-off').es).toContain('Permito que Sara compre billetes por mí');
    expect(refused('no-funds').en).toContain('Nothing has been charged.');
    expect(refused('no-funds').es).toContain('No se ha cobrado nada.');
    expect(refused('no-fare').en).toContain('I will not guess');
    expect(refused('no-fare').es).toContain('no voy a suponerla');
  });
});

const provenance: Provenance = {
  sourceId: 'transitous',
  dataTime: '2026-11-11T12:00:00.000Z',
  receivedAt: '2026-11-11T12:00:00.000Z',
  ageSeconds: 0,
  state: 'healthy',
  evidence: 'Answered by the test double.',
};

const leg = (mode: Leg['mode'], route = 'A'): Leg => ({
  mode,
  from: HARLEM_ACBD,
  to: BRYANT_PARK,
  departAt: '2026-11-11T12:00:00.000Z',
  arriveAt: '2026-11-11T12:20:00.000Z',
  route: mode === 'walk' ? null : { id: route, shortName: route, headsign: null },
  tripId: null,
  timing: 'scheduled',
  provenance,
  path: [],
});

function planOf(legs: readonly Leg[]): PlanResponse {
  return {
    planId: 'plan-1',
    generatedAt: '2026-11-11T12:00:00.000Z',
    itineraries: [
      {
        id: 'it-1',
        departAt: '2026-11-11T12:00:00.000Z',
        arriveAt: '2026-11-11T12:40:00.000Z',
        spareMinutes: 5,
        transfers: legs.length - 1,
        walkMinutes: 0,
        legs: [...legs],
        fare: null,
      },
    ],
    recommendedId: 'it-1',
    notices: [],
  };
}

/** Asks for the planned trip's tickets; returns the products bought, or why none were. */
async function ticketsFor(legs: readonly Leg[]): Promise<readonly string[] | string> {
  const asked: string[] = [];
  const ports = {
    logger: memoryLogger().logger,
    tickets: {
      buy: (_traveller: string, productIds: readonly string[]) => {
        asked.push(...productIds);
        return Promise.resolve({ ok: true, receipts: [] } as const);
      },
    },
  } as unknown as PlanningPorts;
  const turn: Turn = {
    state: { ...emptyState(), plan: planOf(legs) },
    notes: [],
    city: [],
    lang: 'en',
    now: new Date('2026-11-11T12:00:00.000Z'),
    travellerId: 'traveller-1',
    signal: undefined,
  };
  const tool = ticketTools[0];
  if (tool === undefined) throw new Error('missing tool');
  await tool.run({ for_trip: true, items: [] }, ports, turn);
  return turn.tickets?.kind === 'refused' ? turn.tickets.reason : asked;
}

describe('the tickets a planned trip needs, by its legs', () => {
  it('one single ride for the subway with a change inside it', async () => {
    expect(
      await ticketsFor([leg('walk'), leg('subway', 'A'), leg('subway', '1'), leg('walk')]),
    ).toEqual(['omny-single-demo']);
  });

  it('one single ride for the subway and a local bus, with the free change', async () => {
    expect(await ticketsFor([leg('subway', 'A'), leg('walk'), leg('bus', 'M15')])).toEqual([
      'omny-single-demo',
    ]);
  });

  it('the ferry paid apart', async () => {
    expect(await ticketsFor([leg('subway', 'A'), leg('ferry', 'ER')])).toEqual([
      'omny-single-demo',
      'nyc-ferry-single-demo',
    ]);
  });

  it('no fare for regional rail: nothing is guessed', async () => {
    expect(await ticketsFor([leg('subway', 'A'), leg('rail', 'LIRR')])).toBe('no-fare');
  });
});
