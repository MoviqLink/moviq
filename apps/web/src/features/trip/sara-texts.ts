import { useLang } from '../../shared/i18n/lang';
import type { BasicReason } from './model/sara';

// Sara's words on the trip card. Spanish has exactly the same keys: TypeScript checks it.
export const saraEn = {
  writing: 'Sara is putting what changed into words…',
  sources: (list: string) => `From ${list}`,
  writtenAt: (time: string) => `written at ${time}`,
  basic: {
    'no-model': 'Sara’s AI is not connected: this is the watch’s own sentence.',
    budget: 'Today’s AI allowance is used up: this is the watch’s own sentence.',
    'model-failed':
      'Sara’s AI gave no answer she can stand behind: this is the watch’s own sentence.',
    privacy: 'Nothing personal goes to Sara’s AI: this is the watch’s own sentence.',
    unreached: 'Sara’s words did not arrive: this is the watch’s own sentence.',
  } satisfies Record<BasicReason, string>,
  ask: {
    label: 'Ask Sara about this trip',
    placeholder: 'Will I make it?',
    send: 'Ask',
    thinking: 'Sara is checking your trip…',
    failed: 'Sara could not answer just now. Nothing changed in your trip. Try again.',
    proposed: 'Sara put this option below for you.',
  },
};

export type SaraDict = typeof saraEn;

export const saraEs: SaraDict = {
  writing: 'Sara está poniendo en palabras lo que ha cambiado…',
  sources: (list: string) => `Según ${list}`,
  writtenAt: (time: string) => `escrito a las ${time}`,
  basic: {
    'no-model': 'La IA de Sara no está conectada: esta es la frase de la vigilancia, en inglés.',
    budget:
      'Hoy ya se ha gastado el uso de IA previsto: esta es la frase de la vigilancia, en inglés.',
    'model-failed':
      'La IA de Sara no ha dado una respuesta que pueda respaldar: esta es la frase de la vigilancia, en inglés.',
    privacy:
      'A la IA de Sara no se envía nada personal: esta es la frase de la vigilancia, en inglés.',
    unreached: 'Las palabras de Sara no han llegado: esta es la frase de la vigilancia, en inglés.',
  },
  ask: {
    label: 'Pregúntale a Sara por este viaje',
    placeholder: '¿Llego a tiempo?',
    send: 'Preguntar',
    thinking: 'Sara está revisando tu viaje…',
    failed: 'Sara no ha podido responder ahora. Tu viaje no ha cambiado. Inténtalo de nuevo.',
    proposed: 'Sara te ha dejado esta opción abajo.',
  },
};

/** Sara's words on the trip card, in the language in use. */
export function useSaraT(): SaraDict {
  return useLang() === 'es' ? saraEs : saraEn;
}
