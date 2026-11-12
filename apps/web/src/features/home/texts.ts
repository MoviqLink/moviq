import { useLang } from '../../shared/i18n/lang';

const s = String;

// How it works', Sara's field and My trips' words. Spanish has exactly the same keys: TypeScript and the tests
// check it.
export const homeEn = {
  title: 'Your AI urban assistant',
  home: 'MovIQ, home',
  skip: 'Skip to Sara',
  photo: 'Lower Manhattan at sunrise, seen across the Hudson River',
  question: 'Where do you need to be, and by when?',
  how: {
    kicker: 'How it works',
    title: 'Sara is your AI urban mobility assistant.',
    lead:
      'Tell her where you are going and when you must arrive. She plans the trip, plans it again ' +
      'if anything changes and buys the tickets you need.',
    stepsTitle: 'What Sara does for you',
    steps: [
      {
        title: 'Tell her where and when',
        body:
          'In your own words, for example: “I need to be at the Brooklyn Museum tomorrow at ' +
          '10:00 am, leaving from Times Square”.',
      },
      {
        title: 'She plans your trip',
        body:
          'With the city’s live data she builds the route leg by leg and shows her plan on a ' +
          'timeline.',
      },
      {
        title: 'She watches and re-plans',
        body:
          'She watches your lines and streets: ask her in the chat or switch it on in “Sara ' +
          'watches for you”. If your plans change or something happens, she plans the trip again ' +
          'and shows you the best options.',
      },
      {
        title: 'She buys your tickets',
        body:
          'With PayPal: you approve once and Sara pays for each ticket, first from your travel ' +
          'wallet. Every pass is yours to see or download.',
      },
    ],
    controlTitle: 'You stay in control',
    control: [
      'One switch, “Let Sara buy tickets for me with PayPal”, turns her purchases on or off.',
      'Every request has a spending limit of $60 and eight tickets, and she never goes over it.',
    ],
    sandbox:
      'Everything happens in PayPal Sandbox: the tickets are demonstrations at the published fare.',
    start: 'Start',
    city: 'See the city live',
  },
  composer: 'Message for Sara',
  placeholder: 'A place and a time, in your own words',
  send: 'Send',
  example: 'For example: “The Brooklyn Museum by 10:00 am tomorrow, from Times Square”.',
  useExample: 'Use this example',
  exampleText: 'The Brooklyn Museum by 10:00 am tomorrow, from Times Square',
  trips: {
    title: 'My trips',
    skip: 'Skip to your trips',
    lead: 'The trips started in this browser. Sara watches each one until you arrive.',
    loading: 'Looking for your trips…',
    empty: 'No trips yet. Tell Sara where you need to be and by when, and start the plan.',
    toSara: 'Plan with Sara',
    count: (n: number) => (n === 1 ? '1 trip' : `${s(n)} trips`),
    arrive: 'Arrive by',
    failed: 'This trip could not be read now. Check the connection and try again.',
    retry: 'Try again',
    status: {
      'on-track': 'On track',
      'at-risk': 'At risk',
      late: 'Late',
      unknown: 'Not known yet',
    },
    completed: 'Finished',
    cancelled: 'Cancelled',
  },
};

export type HomeDict = typeof homeEn;

export const homeEs: HomeDict = {
  title: 'Tu asistente urbano de IA',
  home: 'MovIQ, inicio',
  skip: 'Saltar a Sara',
  photo: 'El sur de Manhattan al amanecer, visto desde el otro lado del río Hudson',
  question: '¿Adónde tienes que llegar, y a qué hora?',
  how: {
    kicker: 'Cómo funciona',
    title: 'Sara es tu asistente de movilidad urbana con IA.',
    lead:
      'Dile adónde vas y a qué hora tienes que llegar. Ella planifica el viaje, lo vuelve a ' +
      'calcular si algo cambia y compra los billetes que necesitas.',
    stepsTitle: 'Lo que Sara hace por ti',
    steps: [
      {
        title: 'Dile adónde y cuándo',
        body:
          'Con tus palabras, por ejemplo: «Tengo que estar en el Brooklyn Museum mañana a las ' +
          '10:00, saliendo de Times Square».',
      },
      {
        title: 'Planifica tu viaje',
        body:
          'Con los datos en directo de la ciudad arma el itinerario tramo a tramo y te enseña su ' +
          'hoja de ruta en una línea de tiempo.',
      },
      {
        title: 'Vigila y vuelve a calcular',
        body:
          'Vigila tus líneas y calles: pídeselo en el chat o actívalo en «Sara vigila por ti». Si ' +
          'cambian tus planes o hay una incidencia, recalcula el viaje y te muestra las mejores ' +
          'opciones.',
      },
      {
        title: 'Compra tus billetes',
        body:
          'Con PayPal: autorizas una vez y Sara paga cada billete, primero de tu billetera de ' +
          'viaje. Tienes cada pase para verlo o descargarlo.',
      },
    ],
    controlTitle: 'Tú tienes el control',
    control: [
      'Un interruptor, «Permito que Sara compre billetes por mí con PayPal», activa o apaga sus compras.',
      'Cada petición tiene un tope de 60 $ y ocho billetes, y ella nunca lo supera.',
    ],
    sandbox:
      'Todo ocurre en PayPal Sandbox: los billetes son demostraciones a la tarifa publicada.',
    start: 'Empezar',
    city: 'Ver la ciudad en directo',
  },
  composer: 'Mensaje para Sara',
  placeholder: 'Un lugar y una hora, con tus palabras',
  send: 'Enviar',
  example: 'Por ejemplo: «El Brooklyn Museum a las 10:00 de mañana, desde Times Square».',
  useExample: 'Usar este ejemplo',
  exampleText: 'El Brooklyn Museum a las 10:00 de mañana, desde Times Square',
  trips: {
    title: 'Mis viajes',
    skip: 'Saltar a tus viajes',
    lead: 'Los viajes empezados en este navegador. Sara vigila cada uno hasta que llegas.',
    loading: 'Buscando tus viajes…',
    empty:
      'Aún no hay viajes. Dile a Sara adónde tienes que llegar y a qué hora, y empieza el plan.',
    toSara: 'Planificar con Sara',
    count: (n: number) => (n === 1 ? '1 viaje' : `${s(n)} viajes`),
    arrive: 'Llegar antes de',
    failed: 'No se ha podido leer este viaje ahora. Revisa la conexión y vuelve a probar.',
    retry: 'Volver a probar',
    status: {
      'on-track': 'A tiempo',
      'at-risk': 'En riesgo',
      late: 'Tarde',
      unknown: 'Aún sin saber',
    },
    completed: 'Terminado',
    cancelled: 'Cancelado',
  },
};

/** The home page's words in the language in use. */
export function useHomeT(): HomeDict {
  return useLang() === 'es' ? homeEs : homeEn;
}
