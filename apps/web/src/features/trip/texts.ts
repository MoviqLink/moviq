import { useLang } from '../../shared/i18n/lang';
import { flightSourcesEn, flightSourcesEs, statusesEn, statusesEs } from './flight-words';

const s = String;

// The trip's words. Spanish has exactly the same keys: TypeScript and the tests check it.
export const tripEn = {
  title: 'Your trip',
  home: 'MovIQ, plan a trip with Sara',
  skip: 'Skip to the trip',
  loading: 'Opening your trip…',
  missingTitle: 'We can’t find this trip',
  missingBody: 'The link may be old or mistyped. Sara can plan it again with you.',
  missingAction: 'Plan a trip',
  failedTitle: 'Your trip did not load',
  failedBody: 'The server did not give a usable answer. Check the connection and try again.',
  retry: 'Try again',
  state: { watching: 'Watching', completed: 'Completed', cancelled: 'Cancelled' },
  status: {
    'on-track': 'On track',
    'at-risk': 'At risk',
    late: 'Late',
    unknown: 'Not known yet',
  },
  checked: (age: string) => `checked ${age} ago`,
  notChecked: 'not checked yet',
  arrive: 'You arrive',
  spare: (n: number) => `${s(n)} min to spare`,
  late: (n: number) => `${s(n)} min late`,
  deadline: (time: string) => `Be there by ${time}`,
  flightPanel: {
    title: (code: string, airport: string) => `Flight ${code} from ${airport}`,
    scheduled: 'Scheduled',
    revised: { revised: 'Revised', predicted: 'Predicted from history' },
    shift: (n: number) =>
      n === 0 ? 'on time' : n > 0 ? `${s(n)} min later` : `${s(-n)} min earlier`,
    terminal: 'Terminal',
    gate: 'Gate',
    notAnnounced: 'Not announced yet',
    status: 'Status',
    statuses: statusesEn,
    movement: { taxiing: 'Taxiing to the runway', airborne: 'In the air' },
    sources: flightSourcesEn,
    basis: {
      'take-off': (time: string, source: string) => `Took off at ${time} (${source}).`,
      revised: (time: string, source: string) =>
        `Your times are planned from the revised departure, ${time} (${source}).`,
      scheduled: (time: string, source: string) =>
        `Your times are planned from the scheduled departure, ${time} (${source}).`,
      'boarding-pass': (time: string) =>
        `Your times are planned from the ${time} departure on your boarding pass.`,
    },
    disagree: 'The sources disagree',
    attribution: 'Flight data by',
    updated: (age: string) => `updated ${age} ago`,
  },
  live: {
    connecting: 'Connecting to the live watch…',
    live: (age: string) => `Live · last update ${age} ago`,
    lost: (since: string, age: string) =>
      `No connection to the live watch since ${since} · last data ${age} ago.`,
    lostNoData: (since: string) => `No connection to the live watch since ${since}.`,
    retryIn: (span: string) => `Trying again in ${span}.`,
    retrying: 'Trying again now.',
    retryNow: 'Reconnect now',
    rejected: 'An update did not match the contract and was not shown.',
  },
  incidents: {
    title: 'What changed',
    kinds: {
      delay: 'Delay',
      alert: 'Service alert',
      traffic: 'Traffic',
      airport: 'Airport',
      flight: 'Flight',
      elevator: 'Elevator',
      'source-down': 'Source down',
    },
    leg: (n: number) => `Step ${s(n)}`,
    impact: (n: number) => `+${s(n)} min`,
    noImpact: 'impact not measured',
  },
  sara: {
    title: 'Sara',
    thinking: 'Sara is checking your options…',
    options: 'Your options',
    recommended: 'Recommended',
    arrive: (time: string) => `Arrive ${time}`,
    free: 'No cost',
    watching: 'Sara is watching every step and will tell you here if anything changes.',
  },
  pay: {
    loading: 'Loading PayPal…',
    unavailable: (reason: string) => `Payments are not available: ${reason}`,
    notEligible: 'PayPal is not available in this browser.',
    loadFailed: 'PayPal did not load. Check the connection and try again.',
    price: (amount: string) => `${amount}, priced by our server`,
    creating: 'Creating the order on our server…',
    approving: 'Approve the payment in the PayPal window.',
    confirming: 'Confirming the payment with our server…',
    captured: (amount: string) => `Paid ${amount} with PayPal.`,
    capturedSandbox: (amount: string) => `Paid ${amount} with PayPal sandbox.`,
    applied: 'The new route was applied with the payment.',
    cancelled: 'You closed PayPal. Nothing was charged and your trip did not change.',
    unconfirmed:
      'PayPal approved it, but our server has not confirmed the charge yet. Nothing ' +
      'changes in your trip until it does; we will ask again shortly.',
    checking: 'Asking our server about the payment…',
    unconfirmedStill:
      'Our server has still not confirmed the charge. Nothing changed in your trip, and ' +
      'no new payment can start until this one is settled.',
    checkAgain: 'Check again',
    declined: 'The payment was not completed. Nothing changes in your trip.',
    failedCreate: 'The order could not be created. Nothing was charged. Try again.',
    failedApprove: 'PayPal could not finish. Nothing was charged. Try again.',
  },
  use: {
    action: 'Use this route',
    applying: 'Changing your route…',
    done: (route: string) => `You are now on: ${route}. Sara keeps watching it.`,
    conflict: 'This route can no longer be taken: the trip is not being watched. Nothing changed.',
    gone: 'This option is no longer on offer. Nothing changed; the options are up to date again.',
    failed: 'The route could not be changed. Nothing changed. Try again.',
  },
  timeline: {
    title: 'Planned and expected',
    zone: 'New York time',
    planned: 'planned leg',
    expected: 'expected arrival',
    expectedAt: (time: string) => `Expected ${time}`,
    noProjection: 'No live projection yet: the times are from the timetable.',
    deadline: 'Arrive by',
    lane: (name: string, planned: string) => `${name}: planned ${planned}`,
  },
  sheet: { expand: 'Show more of the trip', collapse: 'Show more of the map' },
  map: (place: string) => `Map of the route to ${place}`,
  mapFailed: 'This browser cannot draw the map. Every step of the trip is in the panel.',
};

export type TripDict = typeof tripEn;

export const tripEs: TripDict = {
  title: 'Tu viaje',
  home: 'MovIQ, planifica un viaje con Sara',
  skip: 'Saltar al viaje',
  loading: 'Abriendo tu viaje…',
  missingTitle: 'No encontramos este viaje',
  missingBody:
    'Puede que el enlace sea antiguo o esté mal escrito. Sara puede planificarlo de nuevo contigo.',
  missingAction: 'Planificar un viaje',
  failedTitle: 'Tu viaje no se ha cargado',
  failedBody:
    'El servidor no ha dado una respuesta utilizable. Revisa la conexión e inténtalo de nuevo.',
  retry: 'Reintentar',
  state: { watching: 'Vigilando', completed: 'Terminado', cancelled: 'Cancelado' },
  status: {
    'on-track': 'A tiempo',
    'at-risk': 'En riesgo',
    late: 'Tarde',
    unknown: 'Aún sin saber',
  },
  checked: (age: string) => `comprobado hace ${age}`,
  notChecked: 'aún sin comprobar',
  arrive: 'Llegas',
  spare: (n: number) => `${s(n)} min de margen`,
  late: (n: number) => `${s(n)} min tarde`,
  deadline: (time: string) => `Tienes que llegar antes de las ${time}`,
  flightPanel: {
    title: (code: string, airport: string) => `Vuelo ${code} desde ${airport}`,
    scheduled: 'Programada',
    revised: { revised: 'Revisada', predicted: 'Prevista por historial' },
    shift: (n: number) =>
      n === 0 ? 'a su hora' : n > 0 ? `${s(n)} min más tarde` : `${s(-n)} min antes`,
    terminal: 'Terminal',
    gate: 'Puerta',
    notAnnounced: 'Aún sin anunciar',
    status: 'Estado',
    statuses: statusesEs,
    movement: { taxiing: 'Rodando hacia la pista', airborne: 'En el aire' },
    sources: flightSourcesEs,
    basis: {
      'take-off': (time: string, source: string) => `Despegó a las ${time} (${source}).`,
      revised: (time: string, source: string) =>
        `Tus horas se planifican con la salida revisada, a las ${time} (${source}).`,
      scheduled: (time: string, source: string) =>
        `Tus horas se planifican con la salida programada, a las ${time} (${source}).`,
      'boarding-pass': (time: string) =>
        `Tus horas se planifican con la salida de las ${time} de tu tarjeta de embarque.`,
    },
    disagree: 'Las fuentes no coinciden (detalle en inglés)',
    attribution: 'Datos de vuelo de',
    updated: (age: string) => `actualizado hace ${age}`,
  },
  live: {
    connecting: 'Conectando con el seguimiento en directo…',
    live: (age: string) => `En directo · último dato hace ${age}`,
    lost: (since: string, age: string) =>
      `Sin conexión con el seguimiento desde las ${since} · último dato hace ${age}.`,
    lostNoData: (since: string) => `Sin conexión con el seguimiento desde las ${since}.`,
    retryIn: (span: string) => `Se vuelve a intentar en ${span}.`,
    retrying: 'Volviendo a intentarlo ahora.',
    retryNow: 'Reconectar ahora',
    rejected: 'Una actualización no cumplía el contrato y no se ha mostrado.',
  },
  incidents: {
    title: 'Qué ha cambiado',
    kinds: {
      delay: 'Retraso',
      alert: 'Aviso del servicio',
      traffic: 'Tráfico',
      airport: 'Aeropuerto',
      flight: 'Vuelo',
      elevator: 'Ascensor',
      'source-down': 'Fuente caída',
    },
    leg: (n: number) => `Paso ${s(n)}`,
    impact: (n: number) => `+${s(n)} min`,
    noImpact: 'impacto sin medir',
  },
  sara: {
    title: 'Sara',
    thinking: 'Sara está revisando tus opciones…',
    options: 'Tus opciones',
    recommended: 'Recomendada',
    arrive: (time: string) => `Llegas a las ${time}`,
    free: 'Sin coste',
    watching: 'Sara vigila cada paso y te lo dirá aquí si algo cambia.',
  },
  pay: {
    loading: 'Cargando PayPal…',
    unavailable: (reason: string) => `Los pagos no están disponibles: ${reason}`,
    notEligible: 'PayPal no está disponible en este navegador.',
    loadFailed: 'PayPal no se ha cargado. Revisa la conexión e inténtalo de nuevo.',
    price: (amount: string) => `${amount}, precio fijado por nuestro servidor`,
    creating: 'Creando el pedido en nuestro servidor…',
    approving: 'Aprueba el pago en la ventana de PayPal.',
    confirming: 'Confirmando el pago con nuestro servidor…',
    captured: (amount: string) => `Pagado ${amount} con PayPal.`,
    capturedSandbox: (amount: string) => `Pagado ${amount} con PayPal sandbox.`,
    applied: 'La nueva ruta se ha aplicado con el pago.',
    cancelled: 'Has cerrado PayPal. No se ha cobrado nada y tu viaje no ha cambiado.',
    unconfirmed:
      'PayPal lo ha aprobado, pero nuestro servidor aún no ha confirmado el cobro. Tu viaje no ' +
      'cambia hasta que lo confirme; volveremos a preguntar en breve.',
    checking: 'Preguntando a nuestro servidor por el pago…',
    unconfirmedStill:
      'Nuestro servidor sigue sin confirmar el cobro. Tu viaje no ha cambiado y no se ' +
      'puede empezar otro pago hasta que este se resuelva.',
    checkAgain: 'Volver a comprobar',
    declined: 'El pago no se ha completado. Tu viaje no cambia.',
    failedCreate: 'No se ha podido crear el pedido. No se ha cobrado nada. Inténtalo de nuevo.',
    failedApprove: 'PayPal no ha podido terminar. No se ha cobrado nada. Inténtalo de nuevo.',
  },
  use: {
    action: 'Usar esta ruta',
    applying: 'Cambiando tu ruta…',
    done: (route: string) => `Ahora vas por: ${route}. Sara la sigue vigilando.`,
    conflict: 'Esta ruta ya no se puede tomar: el viaje ya no se vigila. No ha cambiado nada.',
    gone: 'Esta opción ya no está en oferta. No ha cambiado nada; las opciones vuelven a estar al día.',
    failed: 'No se ha podido cambiar la ruta. No ha cambiado nada. Inténtalo de nuevo.',
  },
  timeline: {
    title: 'Previsto y esperado',
    zone: 'Hora de Nueva York',
    planned: 'tramo previsto',
    expected: 'llegada esperada',
    expectedAt: (time: string) => `Esperada ${time}`,
    noProjection: 'Aún sin proyección en directo: las horas son del horario.',
    deadline: 'Llegar antes de',
    lane: (name: string, planned: string) => `${name}: previsto ${planned}`,
  },
  sheet: { expand: 'Ver más del viaje', collapse: 'Ver más del mapa' },
  map: (place: string) => `Mapa de la ruta hasta ${place}`,
  mapFailed:
    'Este navegador no puede dibujar el mapa. Todos los pasos del viaje están en el panel.',
};

/** The trip's words in the language in use. */
export function useTripT(): TripDict {
  return useLang() === 'es' ? tripEs : tripEn;
}
