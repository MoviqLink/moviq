import { useLang } from '../../shared/i18n/lang';

const s = String;

// The planner's words. Spanish has exactly the same keys: TypeScript and the tests check it.
export const planEn = {
  title: 'Plan with Sara',
  home: 'MovIQ, plan a trip with Sara',
  skip: 'Skip to the conversation',
  sara: 'Sara',
  you: 'You',
  question: 'Where do you need to be, and by when?',
  lead:
    'Tell Sara in your own words. She plans backwards from the time you ' +
    'must arrive and asks only for what is missing.',
  example: 'For example: “The Brooklyn Museum by 10:00 am tomorrow, from Times Square”.',
  useExample: 'Use this example',
  exampleText: 'The Brooklyn Museum by 10:00 am tomorrow, from Times Square',
  composer: 'Message for Sara',
  reply: 'Answer Sara, or change anything',
  send: 'Send',
  sending: 'Sara is reading…',
  thinking: 'Sara is checking places, times and routes…',
  failed: {
    network: 'Sara did not get your message: the connection failed.',
    timedOut: 'Sara took too long to answer.',
    contract: 'Sara answered in a shape this screen does not accept, so nothing was shown.',
    server: (status: string) => `Sara could not answer (error ${status}).`,
    kept: 'Your message is kept.',
    retry: 'Send again',
  },
  understood: {
    title: 'What Sara understood',
    origin: 'From',
    destination: 'To',
    arriveBy: 'Arrive by',
    flight: 'Flight',
    missing: 'Sara will ask',
    flightLine: (code: string, airport: string, time: string) =>
      `${code} · ${airport} · departs ${time}`,
    terminal: (terminal: string) => `Terminal ${terminal}`,
    basic:
      'Basic mode: Sara is reading places, times and flights by rules, without a language model.',
    restart: 'Start again',
  },
  plan: {
    found: (n: number) => (n === 1 ? '1 way to get there' : `${s(n)} ways to get there`),
    none: 'Sara found no way to arrive in time.',
    recommended: 'Recommended',
    leave: 'Leave',
    arrive: 'Arrive',
    spare: (n: number) => `${s(n)} min spare`,
    lateBy: (n: number) => `${s(n)} min late`,
    transfers: (n: number) =>
      n === 0 ? 'No transfers' : n === 1 ? '1 transfer' : `${s(n)} transfers`,
    walk: (n: number) => `${s(n)} min on foot`,
    fare: (amount: string) => `${amount} public fare`,
    noFare: 'Fare not calculated',
    start: 'Start this trip',
    starting: 'Starting…',
    startFailed: 'The trip could not be started. Nothing was saved. Try again.',
  },
  city: {
    label: (subject: string) => `What Sara found about ${subject}`,
    levels: {
      clear: 'Nothing in force',
      notice: 'In force now',
      unknown: 'Could not be checked',
      info: 'Live data',
    },
    source: 'Source',
    sources: 'Sources',
    dataOf: (time: string) => `data of ${time}`,
    states: {
      healthy: 'live',
      degraded: 'late',
      stale: 'too old to rely on',
      unavailable: 'not available now',
      rate_limited: 'paused by the provider',
      misconfigured: 'not connected',
      outside_service: 'outside its hours',
      unknown: 'not checked yet',
    },
  },
};

export type PlanDict = typeof planEn;

export const planEs: PlanDict = {
  title: 'Planifica con Sara',
  home: 'MovIQ, planifica un viaje con Sara',
  skip: 'Saltar a la conversación',
  sara: 'Sara',
  you: 'Tú',
  question: '¿Adónde tienes que llegar, y a qué hora?',
  lead:
    'Díselo a Sara con tus palabras. Planifica hacia atrás desde la hora a la ' +
    'que debes llegar y solo pregunta lo que falta.',
  example: 'Por ejemplo: «El Brooklyn Museum a las 10:00 de mañana, desde Times Square».',
  useExample: 'Usar este ejemplo',
  exampleText: 'El Brooklyn Museum a las 10:00 de mañana, desde Times Square',
  composer: 'Mensaje para Sara',
  reply: 'Contesta a Sara o cambia lo que quieras',
  send: 'Enviar',
  sending: 'Sara está leyendo…',
  thinking: 'Sara está comprobando lugares, horas y rutas…',
  failed: {
    network: 'Sara no ha recibido tu mensaje: ha fallado la conexión.',
    timedOut: 'Sara ha tardado demasiado en contestar.',
    contract:
      'Sara ha contestado con un formato que esta pantalla no acepta, así que no se muestra nada.',
    server: (status: string) => `Sara no ha podido contestar (error ${status}).`,
    kept: 'Tu mensaje se conserva.',
    retry: 'Enviar de nuevo',
  },
  understood: {
    title: 'Lo que Sara ha entendido',
    origin: 'Desde',
    destination: 'Hasta',
    arriveBy: 'Llegar antes de',
    flight: 'Vuelo',
    missing: 'Sara lo preguntará',
    flightLine: (code: string, airport: string, time: string) =>
      `${code} · ${airport} · sale a las ${time}`,
    terminal: (terminal: string) => `Terminal ${terminal}`,
    basic: 'Modo básico: Sara lee lugares, horas y vuelos con reglas, sin modelo de lenguaje.',
    restart: 'Empezar de nuevo',
  },
  plan: {
    found: (n: number) => (n === 1 ? '1 forma de llegar' : `${s(n)} formas de llegar`),
    none: 'Sara no ha encontrado ninguna forma de llegar a tiempo.',
    recommended: 'Recomendada',
    leave: 'Sal',
    arrive: 'Llegas',
    spare: (n: number) => `${s(n)} min de margen`,
    lateBy: (n: number) => `${s(n)} min tarde`,
    transfers: (n: number) =>
      n === 0 ? 'Sin transbordos' : n === 1 ? '1 transbordo' : `${s(n)} transbordos`,
    walk: (n: number) => `${s(n)} min a pie`,
    fare: (amount: string) => `${amount} de tarifa pública`,
    noFare: 'Tarifa no calculada',
    start: 'Empezar este viaje',
    starting: 'Empezando…',
    startFailed: 'No se ha podido empezar el viaje. No se ha guardado nada. Inténtalo de nuevo.',
  },
  city: {
    label: (subject: string) => `Lo que Sara ha encontrado sobre ${subject}`,
    levels: {
      clear: 'Nada en vigor',
      notice: 'En vigor ahora',
      unknown: 'Sin poder comprobarlo',
      info: 'Datos en directo',
    },
    source: 'Fuente',
    sources: 'Fuentes',
    dataOf: (time: string) => `datos de las ${time}`,
    states: {
      healthy: 'en directo',
      degraded: 'con retraso',
      stale: 'demasiado antiguos',
      unavailable: 'no disponible ahora',
      rate_limited: 'en pausa por el proveedor',
      misconfigured: 'sin conectar',
      outside_service: 'fuera de su horario',
      unknown: 'aún sin comprobar',
    },
  },
};

/** The planner's words in the language in use. */
export function usePlanT(): PlanDict {
  return useLang() === 'es' ? planEs : planEn;
}
