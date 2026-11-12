import { MAX_ALERTS } from './alerts.js';
import type { AlertList, Finding, LineLive, OutageFact } from './findings.js';
import type { RouteRef } from './lines.js';
import {
  capital,
  minutes,
  modeName,
  routeName,
  when,
  type Card,
  type Item,
  type Telling,
} from './words-common.js';

/** A noun in both languages, singular and plural, with its Spanish gender. */
interface Noun {
  readonly en: string;
  readonly enOne: string;
  readonly es: string;
  readonly esOne: string;
  readonly feminine: boolean;
}

const ALERTS: Noun = {
  en: 'alerts',
  enOne: 'alert',
  es: 'avisos',
  esOne: 'aviso',
  feminine: false,
};
const INCIDENTS: Noun = {
  en: 'incidents',
  enOne: 'incident',
  es: 'incidencias',
  esOne: 'incidencia',
  feminine: true,
};
const PROGRAMS: Noun = {
  en: 'FAA programs',
  enOne: 'FAA program',
  es: 'programas de la FAA',
  esOne: 'programa de la FAA',
  feminine: false,
};

/** The alerts as items, in English as published; the Spanish headline says so. */
function alertItems(list: AlertList): Item[] {
  return (list.alerts ?? [])
    .slice(0, MAX_ALERTS)
    .map((alert) => ({ text: alert.text, at: alert.since }));
}

/** The verdict on a list of alerts: never "none" from a list that could not be read or is old. */
function alertsHeadline(list: AlertList, where: string, noun: Noun, { say }: Telling): string {
  const { en, es, enOne, esOne } = noun;
  const [article, old] = noun.feminine ? ['las', 'antiguas'] : ['los', 'antiguos'];
  if (list.alerts === null) {
    return say(
      `I can't check the ${en} of ${where} right now.`,
      `Ahora no puedo comprobar ${article} ${es} de ${where}.`,
    );
  }
  const count = list.alerts.length;
  if (count === 0 && list.aged) {
    return say(
      `The ${en} I have of ${where} are too old to say there are none.`,
      `${article === 'las' ? 'Las' : 'Los'} ${es} que tengo de ${where} son demasiado ${old} ` +
        'para decir que no hay.',
    );
  }
  if (count === 0) {
    return say(`There are no ${en} in force on ${where}.`, `No hay ${es} en vigor en ${where}.`);
  }
  const n = String(count);
  return say(
    count === 1
      ? `There is 1 ${enOne} in force on ${where}.`
      : `There are ${n} ${en} in force on ${where}.`,
    `${count === 1 ? `Hay 1 ${esOne}` : `Hay ${n} ${es}`} en vigor en ${where}; ` +
      'se publican en inglés.',
  );
}

function levelOf(list: AlertList, more: boolean): Card['level'] {
  if ((list.alerts?.length ?? 0) > 0 || more) return 'notice';
  return list.alerts === null || list.aged ? 'unknown' : 'clear';
}

type LineStatus = Extract<Finding, { kind: 'line-status' }>;
type Incidents = Extract<Finding, { kind: 'incidents' }>;

export function lineStatusCard(finding: LineStatus, told: Telling): Card {
  const { say } = told;
  const where = routeName(finding.route, say);
  const live =
    finding.live === null
      ? finding.route.mode === 'path'
        ? []
        : [
            {
              text: say(
                `I can't see ${where} live right now.`,
                `Ahora no veo ${where} en directo.`,
              ),
              at: null,
            },
          ]
      : liveItems(finding.live, finding.route, told);
  const seen = (finding.live?.held.length ?? 0) + (finding.live?.late.length ?? 0) > 0;
  return {
    kind: 'line-status',
    subject: finding.route.label,
    level: levelOf(finding.alerts, seen),
    headline: alertsHeadline(finding.alerts, where, ALERTS, told),
    items: [...alertItems(finding.alerts), ...live].slice(0, 8),
  };
}

function liveItems(live: LineLive, route: RouteRef, { say }: Telling): Item[] {
  const vehicles = route.mode === 'bus' ? say('buses', 'autobuses') : say('trains', 'trenes');
  const line = routeName(route, say);
  const n = String(live.followed);
  const items: Item[] = [
    {
      text: say(
        `${capital(vehicles)} of ${line} followed live now: ${n}.`,
        `${capital(vehicles)} de ${line} en seguimiento en directo: ${n}.`,
      ),
      at: null,
    },
  ];
  for (const held of live.held.slice(0, 2)) {
    const [elapsed, usual, runs] = [
      minutes(held.elapsedSeconds),
      minutes(held.usualSeconds),
      String(held.n),
    ];
    items.push({
      text: say(
        `A train to ${held.destination} left ${held.leftStop} ${elapsed} min ago; ` +
          `in ${runs} recorded runs it took ${usual} min at most.`,
        `Un tren hacia ${held.destination} salió de ${held.leftStop} hace ${elapsed} min; ` +
          `en ${runs} recorridos grabados se tardó ${usual} min como mucho.`,
      ),
      at: null,
    });
  }
  for (const bus of live.late.slice(0, 2)) {
    const name = bus.name === null ? '' : ` ${bus.name}`;
    const late = String(bus.minutes);
    items.push({
      text: say(
        `Bus${name} to ${bus.destination} is ${late} min behind its timetable, by Bus Time.`,
        `El autobús${name} hacia ${bus.destination} va ${late} min tarde según Bus Time.`,
      ),
      at: null,
    });
  }
  if (live.cancelled !== null && live.cancelled > 0) {
    const n = String(live.cancelled);
    items.push({
      text:
        live.cancelled === 1
          ? say('The MTA feed lists 1 trip as cancelled.', 'La MTA da 1 viaje como cancelado.')
          : say(
              `The MTA feed lists ${n} trips as cancelled.`,
              `La MTA da ${n} viajes como cancelados.`,
            ),
      at: null,
    });
  }
  return items;
}

export function incidentsCard(finding: Incidents, told: Telling): Card {
  const { say } = told;
  const where =
    finding.scope === 'trip'
      ? say(`your trip (${finding.subject})`, `tu viaje (${finding.subject})`)
      : finding.route !== null
        ? routeName(finding.route, say)
        : finding.mode === null
          ? finding.subject
          : modeName(finding.mode, say);
  const station = finding.scope === 'station';
  const outages = station ? outageItems(finding.outages, told) : [];
  const out = (finding.outages?.length ?? 0) > 0;
  const level = levelOf(finding.alerts, out);
  return {
    kind: 'incidents',
    subject: finding.scope === 'trip' ? say('Your trip', 'Tu viaje') : finding.subject,
    level: station && finding.outages === null && level === 'clear' ? 'unknown' : level,
    headline: alertsHeadline(
      finding.alerts,
      where,
      finding.mode === 'airports' ? PROGRAMS : INCIDENTS,
      told,
    ),
    items: [...alertItems(finding.alerts), ...outages].slice(0, 8),
  };
}

function outageItems(outages: readonly OutageFact[] | null, told: Telling): Item[] {
  const { say } = told;
  if (outages === null) {
    const text = say(
      "I can't check its elevators right now.",
      'Ahora no puedo comprobar sus ascensores.',
    );
    return [{ text, at: null }];
  }
  return outages.map((outage) => ({ text: outageText(outage, told), at: outage.since }));
}

/** "Elevator out of service: street to mezzanine. Back by 6:00 pm, by the MTA's estimate." */
export function outageText(outage: OutageFact, told: Telling): string {
  const { say } = told;
  const kind =
    outage.kind === 'elevator'
      ? say('Elevator', 'Ascensor')
      : say('Escalator', 'Escalera mecánica');
  const back =
    outage.estimatedReturn === null
      ? say(' The MTA gives no return time.', ' La MTA no da hora de vuelta.')
      : say(
          ` Back by ${when(outage.estimatedReturn, told)}, by the MTA's estimate.`,
          ` Vuelve hacia las ${when(outage.estimatedReturn, told)}, según la MTA.`,
        );
  const path = !outage.ada
    ? ''
    : outage.redundant === true
      ? say(' Another elevator gives the same access.', ' Otro ascensor da el mismo acceso.')
      : outage.redundant === false
        ? say(' No other elevator gives this access.', ' Ningún otro ascensor da este acceso.')
        : '';
  const serving = outage.serving === '' ? '' : `: ${outage.serving}`;
  return `${kind} ${say('out of service', 'fuera de servicio')}${serving}.${path}${back}`;
}
