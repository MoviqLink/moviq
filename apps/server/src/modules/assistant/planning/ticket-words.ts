import type { Money } from '@moviq/contracts';

import type { AutopayReceipt } from '../../tickets/autopay.js';
import type { Lang } from './state.js';

/** Why Sara bought nothing, each with its own words for the traveller. */
export type TicketRefusal =
  | 'unavailable'
  | 'switched-off'
  | 'no-funds'
  | 'unknown-product'
  | 'limit'
  | 'no-plan'
  | 'no-fare'
  | 'nothing-asked';

/** What happened to a purchase this turn: told with fixed words, never with the model's. */
export type TicketNote =
  | { readonly kind: 'bought'; readonly receipts: readonly AutopayReceipt[] }
  | { readonly kind: 'refused'; readonly reason: TicketRefusal };

const REFUSED: Readonly<Record<Lang, Readonly<Record<TicketRefusal, string>>>> = {
  en: {
    unavailable: 'I cannot buy tickets on this server right now. Nothing has been charged.',
    'switched-off':
      'You have switched off “Let Sara buy tickets for me”, so I have bought nothing. ' +
      'Switch it on in this screen and ask me again.',
    'no-funds':
      'Your trip wallet does not cover it and PayPal is not connected. Add funds in your ' +
      'dashboard (Wallet), or press “Connect PayPal” on this screen and approve once. ' +
      'Nothing has been charged.',
    'unknown-product': 'I do not have that ticket in the catalogue. Nothing has been charged.',
    limit:
      'That is more than I may buy in one go (8 tickets or $60). Nothing has been charged; ' +
      'ask me for fewer.',
    'no-plan':
      'There is no planned trip yet. Tell me where you are going, or name the ticket you want.',
    'no-fare':
      'This trip has no verified fare, so I will not guess. Tell me which ticket you want.',
    'nothing-asked': 'Tell me which ticket you want and how many.',
  },
  es: {
    unavailable: 'Ahora mismo no puedo comprar billetes en este servidor. No se ha cobrado nada.',
    'switched-off':
      'Tienes desactivado «Permito que Sara compre billetes por mí», así que no he comprado ' +
      'nada. Actívalo en esta pantalla y vuelve a pedírmelo.',
    'no-funds':
      'Tu billetera de viaje no lo cubre y PayPal no está conectado. Añade fondos en tu panel ' +
      '(Billetera) o pulsa «Conectar PayPal» en esta pantalla y aprueba una sola vez. No se ' +
      'ha cobrado nada.',
    'unknown-product': 'No tengo ese billete en el catálogo. No se ha cobrado nada.',
    limit:
      'Eso supera lo que puedo comprar de una vez (8 billetes o 60 $). No se ha cobrado nada; ' +
      'pídeme menos.',
    'no-plan': 'Todavía no hay un viaje planificado. Dime adónde vas o qué billete quieres.',
    'no-fare':
      'Este viaje no tiene una tarifa verificada y no voy a suponerla. Dime qué billete quieres.',
    'nothing-asked': 'Dime qué billete quieres y cuántos.',
  },
};

function money(amount: Money, lang: Lang): string {
  const value = (amount.amountMinor / 100).toFixed(2);
  return lang === 'es' ? `${value.replace('.', ',')} $` : `$${value}`;
}

/** "2 × OMNY single ride ($3.00 each)", one entry per product. */
function lines(receipts: readonly AutopayReceipt[], lang: Lang): string[] {
  const counted = new Map<string, { count: number; receipt: AutopayReceipt }>();
  for (const receipt of receipts) {
    const seen = counted.get(receipt.product.id);
    if (seen === undefined) counted.set(receipt.product.id, { count: 1, receipt });
    else seen.count += 1;
  }
  return [...counted.values()].map(({ count, receipt }) => {
    const price = money(receipt.product.price, lang);
    const each = count === 1 ? price : lang === 'es' ? `${price} cada uno` : `${price} each`;
    return `${String(count)} × ${receipt.product.name} (${each})`;
  });
}

/** Where the money came from: the trip wallet, the connected PayPal, or both. */
function paidWith(bought: readonly AutopayReceipt[], lang: Lang): string {
  const sources = new Set(bought.flatMap((receipt) => (receipt.bought ? [receipt.paidWith] : [])));
  const wallet = lang === 'es' ? 'de tu billetera de viaje' : 'from your trip wallet';
  const paypal = lang === 'es' ? 'con tu PayPal' : 'with your PayPal';
  if (sources.size === 2) return `${wallet} ${lang === 'es' ? 'y' : 'and'} ${paypal}`;
  return sources.has('wallet') ? wallet : paypal;
}

function joined(parts: readonly string[], lang: Lang): string {
  if (parts.length <= 1) return parts.join('');
  const last = parts[parts.length - 1] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${last}`;
}

/** Sara's words about a purchase: every ticket, price, total and PayPal order as recorded. */
export function ticketReply(note: TicketNote, lang: Lang): string {
  if (note.kind === 'refused') return REFUSED[lang][note.reason];
  const bought = note.receipts.filter((receipt) => receipt.bought);
  const failed = note.receipts.filter((receipt) => !receipt.bought);
  const sentences: string[] = [];
  if (bought.length > 0) {
    const total = money(
      {
        amountMinor: bought.reduce((sum, receipt) => sum + receipt.product.price.amountMinor, 0),
        currency: 'USD',
      },
      lang,
    );
    const orders = bought.flatMap((receipt) =>
      receipt.paypalOrderId === null ? [] : [receipt.paypalOrderId],
    );
    const what = joined(lines(bought, lang), lang);
    const source = paidWith(bought, lang);
    sentences.push(
      lang === 'es'
        ? `Hecho. He comprado ${what} y he pagado ${total} ${source}, sin pedirte otra aprobación.`
        : `Done. I bought ${what} and paid ${total} ${source}, with no further approval.`,
    );
    if (orders.length > 0) {
      sentences.push(
        lang === 'es'
          ? `${orders.length === 1 ? 'Pedido' : 'Pedidos'} de PayPal: ${orders.join(', ')}.`
          : `PayPal ${orders.length === 1 ? 'order' : 'orders'}: ${orders.join(', ')}.`,
      );
    }
    sentences.push(
      lang === 'es'
        ? 'Aquí los tienes para verlos o descargarlos; también están en tu panel.'
        : 'Here they are to view or download; they are in your dashboard too.',
    );
  }
  if (failed.length > 0) {
    const missed = joined(lines(failed, lang), lang);
    sentences.push(
      lang === 'es'
        ? `No he podido comprar ${missed}: PayPal no lo ha confirmado y eso no se ha cobrado.`
        : `I could not buy ${missed}: PayPal did not confirm it and that was not charged.`,
    );
  }
  return sentences.join('\n');
}
