import type { Journey } from '@moviq/contracts';

import type { BasicReason } from '../planning/replies.js';
import type { Lang } from '../planning/state.js';
import { moneyText } from './facts.js';
import type { Proposal } from './propose.js';

const words = (lang: Lang) => (en: string, es: string) => (lang === 'es' ? es : en);

/** Why Sara answers about the trip with fixed words, said first. */
export function tripBasicNotice(reason: BasicReason, lang: Lang): string {
  const say = words(lang);
  switch (reason) {
    case 'no-model':
      return say(
        'My AI is not connected, so I can only give you what the watch says.',
        'Mi IA no está conectada, así que solo puedo darte lo que dice la vigilancia.',
      );
    case 'budget':
      return say(
        "Today's AI allowance is used up, so I can only give you what the watch says.",
        'Hoy ya se ha gastado el uso de IA previsto, así que solo puedo darte lo que dice la vigilancia.',
      );
    case 'model-failed':
      return say(
        'My AI did not give an answer I can stand behind, so here is what the watch says.',
        'Mi IA no ha dado una respuesta que pueda respaldar, así que te doy lo que dice la vigilancia.',
      );
    case 'privacy':
      return say(
        'So that nothing personal is sent to my AI, here is what the watch says.',
        'Para que no se envíe nada personal a mi IA, te doy lo que dice la vigilancia.',
      );
  }
}

/** The watch's own sentence; in Spanish, said to be in English as the server wrote it. */
export function watchSentence(journey: Journey, lang: Lang): string {
  return words(lang)(
    `The watch says: ${journey.watch.evidence}`,
    `La vigilancia dice, en inglés: «${journey.watch.evidence}»`,
  );
}

/** The option Sara put on screen, with the server's price when it has one. */
export function proposalSentence(proposal: Proposal, lang: Lang): string {
  const say = words(lang);
  if (proposal.price === null) {
    return say(
      `You can switch to ${proposal.rides}: tap "Use this route" to take it.`,
      `Puedes cambiar a ${proposal.rides}: toca «Usar esta ruta» para tomarla.`,
    );
  }
  const price = moneyText(proposal.price, lang);
  return say(
    `You can switch to ${proposal.rides} for ${price}, priced by our server: pay below with ` +
      'PayPal; nothing is charged until PayPal confirms it.',
    `Puedes cambiar a ${proposal.rides} por ${price}, precio fijado por nuestro servidor: paga ` +
      'abajo con PayPal; no se cobra nada hasta que PayPal lo confirme.',
  );
}
