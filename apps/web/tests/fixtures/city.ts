import type { AssistantTurn, CityAnswer, CitySource } from '@moviq/contracts';

import type { Lang } from './geography';
import { iso } from './itineraries';

// Sara's answers about the city, shaped by the contract: the words a basic turn gives, as offsets
// from `now`. For tests and the visual review only.

const say = (lang: Lang, en: string, es: string) => (lang === 'es' ? es : en);

const source = (
  now: number,
  sourceId: string,
  title: string,
  state: CitySource['state'] = 'healthy',
): CitySource => ({
  sourceId,
  title,
  dataTime: state === 'unavailable' ? null : iso(now - 60_000),
  ageSeconds: state === 'unavailable' ? null : 60,
  state,
});

/** "How is the A?": one alert in force, the trains followed live and one trip cancelled. */
function lineStatus(now: number, lang: Lang): CityAnswer {
  return {
    kind: 'line-status',
    subject: 'A',
    level: 'notice',
    headline: say(
      lang,
      'There is 1 alert in force on the A.',
      'Hay 1 aviso en vigor en la A; se publican en inglés.',
    ),
    items: [
      { text: 'A C trains are running with delays in both directions.', at: iso(now - 3_600_000) },
      {
        text: say(
          lang,
          'Trains of the A followed live now: 14.',
          'Trenes de la A en seguimiento en directo: 14.',
        ),
        at: null,
      },
      {
        text: say(
          lang,
          'The MTA feed lists 1 trip as cancelled.',
          'La MTA da 1 viaje como cancelado.',
        ),
        at: null,
      },
    ],
    sources: [
      source(now, 'mta-alerts', 'MTA service alerts (subway, buses, LIRR, Metro-North)'),
      source(now, 'mta-subway-ace', 'MTA subway live: A C E and Rockaway shuttle'),
    ],
  };
}

/** "Is the elevator at 59 St working?" while the outages feed cannot be read. */
function stationUnknown(now: number, lang: Lang): CityAnswer {
  return {
    kind: 'station-access',
    subject: '59 St-Columbus Circle',
    level: 'unknown',
    headline: say(
      lang,
      "I can't check the elevators and escalators of 59 St-Columbus Circle right now.",
      'Ahora no puedo comprobar los ascensores y escaleras mecánicas de 59 St-Columbus Circle.',
    ),
    items: [
      {
        text: say(
          lang,
          'Step-free northbound only, by the MTA. MTA note: Uptown only.',
          'Sin escalones solo en sentido norte, según la MTA. Nota de la MTA: Uptown only.',
        ),
        at: null,
      },
      {
        text: say(
          lang,
          'An accessible station does not guarantee the whole route: check every station of your trip.',
          'Que una estación sea accesible no garantiza todo el itinerario: comprueba cada estación del viaje.',
        ),
        at: null,
      },
    ],
    sources: [
      source(now, 'mta-subway-stations', 'MTA Subway Stations, step-free access by direction'),
      source(now, 'mta-elevators', 'MTA elevator and escalator outages', 'unavailable'),
    ],
  };
}

/** A basic turn that answered about the A and about 59 St-Columbus Circle. */
export function cityTurn(now: number, lang: Lang): AssistantTurn {
  const [status, station] = [lineStatus(now, lang), stationUnknown(now, lang)];
  return {
    conversationId: 'conv-city',
    mode: 'basic',
    reply: [status.headline, ...status.items.slice(0, 2).map((item) => item.text)].join(' '),
    draft: { origin: null, destination: null, arriveBy: null, flight: null },
    missing: ['destination', 'arriveBy', 'origin'],
    plan: null,
    city: [status, station],
  };
}
