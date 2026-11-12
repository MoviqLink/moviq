/**
 * The server's sentences when it refuses a reservation, a confirmation or a cancellation, as it
 * writes them in English, with their Spanish. A sentence not listed here is shown as the server
 * wrote it, said to be in English.
 */
const SPANISH: Readonly<Record<string, string>> = {
  'There is no offer with that id.': 'Esta oferta ya no existe.',
  'This offer is no longer available.': 'Esta oferta ya no está disponible.',
  'This offer has expired.': 'Esta oferta ha caducado.',
  'The pickup time of this offer has passed.': 'La hora de recogida de esta oferta ya ha pasado.',
  'PayPal is not available right now. Nothing has been charged; try again shortly.':
    'PayPal no está disponible ahora. No se ha cobrado nada; vuelve a probar en un momento.',
  'Approve the reservation in the PayPal window first. Nothing has been held.':
    'Aprueba primero la reserva en la ventana de PayPal. No se ha retenido nada.',
  'PayPal could not hold this payment. Nothing has been charged.':
    'PayPal no ha podido retener este pago. No se ha cobrado nada.',
  'PayPal declined this payment method. Nothing has been charged.':
    'PayPal ha rechazado este medio de pago. No se ha cobrado nada.',
  'This PayPal reservation expired before it was approved. Nothing has been charged.':
    'Esta reserva de PayPal ha caducado antes de aprobarse. No se ha cobrado nada.',
  'We could not keep this reservation, so the money held in PayPal was released.':
    'No hemos podido mantener esta reserva, así que el dinero retenido en PayPal se ha liberado.',
  'We could not keep this reservation. The money held in PayPal is being released; nothing will be charged.':
    'No hemos podido mantener esta reserva. El dinero retenido en PayPal se está liberando; no se cobrará nada.',
  'This reservation is closed. Nothing more will be charged.':
    'Esta reserva está cerrada. No se cobrará nada más.',
  'This reservation is still being set up with PayPal. Try again in a moment.':
    'Esta reserva aún se está preparando con PayPal. Vuelve a probar en un momento.',
  'This order is already cancelled.': 'Este pedido ya está cancelado.',
  'The kitchen has already started this order, so it can no longer be cancelled for free.':
    'La cocina ya ha empezado este pedido, así que ya no se puede cancelar gratis.',
};

/** The server's sentence in the reader's language; null when the server gave none. */
export function serverWords(message: string | null, lang: 'en' | 'es'): string | null {
  if (message === null) return null;
  if (lang === 'en') return message;
  return SPANISH[message] ?? `El servidor dice, en inglés: «${message}»`;
}
