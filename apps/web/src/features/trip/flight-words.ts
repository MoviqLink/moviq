// The words of a flight's facts, in English and Spanish, for `texts.ts`.

/** AeroDataBox's statuses (OpenAPI `FlightStatus`); one it adds later is shown as it comes. */
export const statusesEn: Readonly<Record<string, string>> = {
  Expected: 'Expected',
  CheckIn: 'Check-in open',
  Boarding: 'Boarding',
  GateClosed: 'Gate closed',
  Departed: 'Departed',
  EnRoute: 'In the air',
  Delayed: 'Delayed',
  Approaching: 'Approaching',
  Arrived: 'Arrived',
  Canceled: 'Cancelled',
  Diverted: 'Diverted',
  CanceledUncertain: 'May be cancelled',
};

export const statusesEs: Readonly<Record<string, string>> = {
  Expected: 'Previsto',
  CheckIn: 'Facturación abierta',
  Boarding: 'Embarcando',
  GateClosed: 'Puerta cerrada',
  Departed: 'Ha salido',
  EnRoute: 'En vuelo',
  Delayed: 'Retrasado',
  Approaching: 'En aproximación',
  Arrived: 'Ha llegado',
  Canceled: 'Cancelado',
  Diverted: 'Desviado',
  CanceledUncertain: 'Puede estar cancelado',
};

/** The sources of a flight's facts, by source id; another id is shown as it is. */
export const flightSourcesEn: Readonly<Record<string, string>> = {
  aerodatabox: 'AeroDataBox',
  'boarding-pass': 'Your boarding pass',
  'adsb-lol-new-york': 'ADS-B · adsb.lol',
  'adsb-fi-new-york': 'ADS-B · adsb.fi',
  'faa-airport-status': 'FAA',
};

export const flightSourcesEs: Readonly<Record<string, string>> = {
  ...flightSourcesEn,
  'boarding-pass': 'Tu tarjeta de embarque',
};
