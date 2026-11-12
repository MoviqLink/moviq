import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OfferRow } from '../src/features/rewards/ui/OfferRow';
import { NeedPanel } from '../src/features/rewards/ui/NeedPanel';
import { OrderCard } from '../src/features/rewards/ui/OrderCard';
import { need, offer, order } from './fixtures/rewards';

// The views are rendered in Spanish whatever the language of the machine running the tests.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'es-ES' } });
});

// Freeze the view clock so offer fixtures do not expire with the machine date.
vi.mock('../src/shared/time/clock', () => ({
  useNow: () => Date.parse('2026-11-11T22:00:00.000Z'),
}));

const nothing = () => undefined;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('an offer on the way', () => {
  it('is a row with the demo merchant, when and where, the detour and the price on the right', () => {
    const html = renderToStaticMarkup(
      createElement(OfferRow, {
        offer: offer({ recommended: true }),
        open: false,
        onToggle: nothing,
        onDeclined: nothing,
        onReserved: nothing,
      }),
    );
    const said = text(html);
    expect(said).toContain('Sara recomienda');
    expect(said).toContain('Tsuki Ramen House demo');
    expect(said).toContain('Listo a las 18:20 · East 125th Street & Lexington Avenue');
    expect(said).toContain('4 min fuera de tu ruta');
    expect(said).toMatch(/14,41\s*US\$/);
    expect(said).toMatch(/16,95\s*US\$/);
    expect(html).toContain('aria-expanded="false"');
  });

  it('does not offer PayPal until the caller has verified the route', () => {
    const html = renderToStaticMarkup(
      createElement(OfferRow, {
        offer: offer({ expiresAt: '2099-01-01T00:00:00.000Z' }),
        open: true,
        onToggle: nothing,
        onDeclined: nothing,
        onReserved: nothing,
        canReserve: false,
        beforeReserve: createElement('span', null, 'Check route first'),
      }),
    );
    expect(html).toContain('Check route first');
    expect(html).not.toContain('Cargando PayPal');
  });

  it('never offers an expired invitation for payment', () => {
    const html = renderToStaticMarkup(
      createElement(OfferRow, {
        offer: offer({ expiresAt: '2000-01-01T00:00:00.000Z' }),
        open: true,
        onToggle: nothing,
        onDeclined: nothing,
        onReserved: nothing,
      }),
    );
    expect(html).toContain('caducad');
    expect(html).not.toContain('Cargando PayPal');
  });

  it('opened, shows the kitchen changes, the reward, who composed it and PayPal', () => {
    const said = text(
      renderToStaticMarkup(
        createElement(OfferRow, {
          offer: offer(),
          open: true,
          onToggle: nothing,
          onDeclined: nothing,
          onReserved: nothing,
        }),
      ),
    );
    expect(said).toContain('sin scallions, sin peanut chili oil');
    expect(said).toMatch(/Ganas 2,54\s*US\$ · 14 %/);
    expect(said).toContain('La han compuesto para ti las reglas del comercio');
    expect(said).toContain(
      'PayPal retiene el importe ahora y lo cobra cuando el comercio escanea tu código.',
    );
    expect(said).toContain('Cargando PayPal…');
    expect(said).toContain('No, gracias');
  });
});

describe("a merchant's question", () => {
  it('comes before the offers, with its answers as buttons', () => {
    const view = need({
      threads: [
        {
          id: 'thread-1',
          merchantId: 'demo-tsuki-ramen-house',
          status: 'awaiting-traveller',
          question: {
            topic: 'spice',
            text: 'Mild or hot for the Tonkotsu ramen?',
            options: ['mild', 'hot'],
          },
          conversation: [],
        },
      ],
    });
    const said = text(
      renderToStaticMarkup(createElement(NeedPanel, { need: view, onNeed: nothing })),
    );
    expect(said).toContain(
      'Un comercio pregunta ¿Suave o picante para el Tonkotsu ramen? Suave Picante',
    );
  });
});

describe('an order', () => {
  it('shows the QR of the signed code, the code itself, the hold and free cancellation', () => {
    const html = renderToStaticMarkup(
      createElement(OrderCard, { order: order(), onChange: nothing }),
    );
    const said = text(html);
    expect(html).toContain('<svg class="reward-qr"');
    expect(html).toContain('aria-label="Código de recogida T-1041"');
    expect(said).toContain('T-1041');
    expect(said).toContain('Retenido en PayPal, sin cobrar');
    expect(said).toContain('Cancelación gratis hasta las 18:08, cuando empieza la cocina.');
    expect(said).toContain('Cancelar gratis');
  });

  it('once collected, shows what was charged and no button to cancel', () => {
    const collected = order({
      status: 'picked_up',
      freeCancellation: false,
      pickup: null,
      payment: { ...order().payment, status: 'captured', captured: order().reward.price },
    });
    const said = text(
      renderToStaticMarkup(createElement(OrderCard, { order: collected, onChange: nothing })),
    );
    expect(said).toContain('Recogido');
    expect(said).toMatch(/Cobrado con PayPal · Cobrado 14,41\s*US\$/);
    expect(said).not.toContain('Cancelar gratis');
  });

  it('says a refund PayPal has not confirmed yet as in progress, never as refunded', () => {
    const pending = order({
      status: 'picked_up',
      pickup: null,
      payment: {
        ...order().payment,
        status: 'captured',
        captured: order().reward.price,
        refundPending: { amountMinor: 300, currency: 'USD' },
      },
    });
    const said = text(
      renderToStaticMarkup(createElement(OrderCard, { order: pending, onChange: nothing })),
    );
    expect(said).toMatch(/Reembolso de 3,00\s*US\$ en curso/);
    expect(said).not.toContain('Devuelto');
  });
});
