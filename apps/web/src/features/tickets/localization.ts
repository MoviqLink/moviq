import type { Lang } from '../../shared/i18n/lang';

interface LocalizedText {
  readonly name: string;
  readonly description: string;
}

const PRODUCTS_ES: Readonly<Record<string, LocalizedText>> = {
  'omny-single-demo': {
    name: 'OMNY, viaje sencillo',
    description: 'Tarifa base publicada para un viaje en el metro de MTA.',
  },
  'omny-local-bus-demo': {
    name: 'Autobús local MTA, viaje sencillo',
    description: 'Tarifa base publicada para un viaje en un autobús local de MTA.',
  },
  'path-single-demo': { name: 'PATH, viaje sencillo', description: 'Tarifa publicada de PATH.' },
  'path-tapp-10-demo': { name: 'PATH TAPP, 10 viajes', description: 'Tarifa publicada de PATH.' },
  'path-tapp-20-demo': { name: 'PATH TAPP, 20 viajes', description: 'Tarifa publicada de PATH.' },
  'path-tapp-40-demo': {
    name: 'PATH TAPP, 40 viajes',
    description: 'Tarifa publicada de PATH TAPP para 40 viajes.',
  },
  'mta-express-demo': {
    name: 'Autobús exprés MTA, viaje sencillo',
    description: 'Tarifa publicada del autobús exprés de MTA.',
  },
  'nyc-ferry-single-demo': {
    name: 'NYC Ferry, viaje sencillo',
    description: 'Tarifa publicada del operador.',
  },
  'nyc-ferry-10-demo': {
    name: 'NYC Ferry, 10 viajes',
    description: 'Tarifa publicada de NYC Ferry para 10 viajes.',
  },
  'jfk-airtrain-demo': {
    name: 'AirTrain de JFK, viaje sencillo',
    description: 'Tarifa publicada del operador.',
  },
  'lirr-cityticket-offpeak-demo': {
    name: 'CityTicket de LIRR, fuera de hora punta',
    description:
      'CityTicket es un viaje de ida dentro de Nueva York en un solo ferrocarril y sin ' +
      'cambiar de sentido. Fuera de hora punta. Se excluyen Belmont Park, Elmont-UBS Arena ' +
      'y Far Rockaway.',
  },
  'mnr-cityticket-offpeak-demo': {
    name: 'CityTicket de Metro-North, fuera de hora punta',
    description:
      'CityTicket es un viaje de ida dentro de Nueva York en un solo ferrocarril y sin ' +
      'cambiar de sentido. Fuera de hora punta. Se excluyen Belmont Park, Elmont-UBS Arena ' +
      'y Far Rockaway.',
  },
  'lirr-cityticket-peak-demo': {
    name: 'CityTicket de LIRR, en hora punta',
    description:
      'CityTicket es un viaje de ida dentro de Nueva York en un solo ferrocarril y sin ' +
      'cambiar de sentido. En hora punta. Se excluyen Belmont Park, Elmont-UBS Arena y Far ' +
      'Rockaway.',
  },
  'mnr-cityticket-peak-demo': {
    name: 'CityTicket de Metro-North, en hora punta',
    description:
      'CityTicket es un viaje de ida dentro de Nueva York en un solo ferrocarril y sin ' +
      'cambiar de sentido. En hora punta. Se excluyen Belmont Park, Elmont-UBS Arena y Far ' +
      'Rockaway.',
  },
};

const INFORMATION_ES: Readonly<Record<string, LocalizedText>> = {
  'omny-weekly-cap': {
    name: 'Tope semanal de tarifa OMNY',
    description:
      'El tope de 35 US$ es un límite tarifario, no un abono prepago. Consulta las condiciones oficiales.',
  },
  'path-unlimited': {
    name: 'Abonos ilimitados PATH TAPP',
    description:
      'Los abonos oficiales de 1, 7 y 30 días cuestan 12,50 US$, 42,75 US$ y 131,50 US$, ' +
      'respectivamente. Consulta con PATH los requisitos y las condiciones.',
  },
  'lirr-mnr': {
    name: 'LIRR y Metro-North',
    description: 'Las tarifas varían según las estaciones, la zona y la hora del viaje.',
  },
  'nj-transit': {
    name: 'Tren y tren ligero de NJ Transit',
    description: 'Las tarifas varían según el trayecto y las zonas.',
  },
  'nj-transit-bus': {
    name: 'Autobús de NJ Transit',
    description: 'Las tarifas varían según el trayecto y las zonas.',
  },
  'staten-island-ferry': { name: 'Ferri de Staten Island', description: 'El ferri es gratuito.' },
  'newark-airtrain': {
    name: 'AirTrain de Newark',
    description: 'La tarifa de acceso al aeropuerto es de 8,75 US$, además del precio del tren.',
  },
};

export function productText(
  id: string,
  name: string,
  description: string,
  lang: Lang,
): LocalizedText {
  return lang === 'es' ? (PRODUCTS_ES[id] ?? { name, description }) : { name, description };
}

export function informationText(
  id: string,
  name: string,
  description: string,
  lang: Lang,
): LocalizedText {
  return lang === 'es' ? (INFORMATION_ES[id] ?? { name, description }) : { name, description };
}

export const DEMO_NOTICE =
  'Demo only. No transit ticket, ride, QR code or operator affiliation is provided.';
export const DEMO_NOTICE_ES =
  'Solo demostración. No se proporciona ningún billete de transporte, viaje, código QR ni afiliación con operadores.';

export function localizedNotice(notice: string, lang: Lang): string {
  return lang === 'es' && notice === DEMO_NOTICE ? DEMO_NOTICE_ES : notice;
}

export const localizationIds = {
  products: Object.keys(PRODUCTS_ES),
  information: Object.keys(INFORMATION_ES),
};
