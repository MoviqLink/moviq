import type { Finding, HeadwayFact, StationFact, VehicleFact } from './findings.js';
import { outageText } from './words-status.js';
import { minutes, routeName, when, type Card, type Item, type Telling } from './words-common.js';

type WhereIs = Extract<Finding, { kind: 'where-is' }>;
type StationAccess = Extract<Finding, { kind: 'station-access' }>;
type Reliability = Extract<Finding, { kind: 'line-reliability' }>;

export function whereIsCard(finding: WhereIs, told: Telling): Card {
  const { say } = told;
  const { vehicles, subject } = finding;
  const total = (vehicles?.length ?? 0) + finding.more;
  const headline =
    vehicles === null
      ? say(`I can't see ${subject} live right now.`, `Ahora no veo ${subject} en directo.`)
      : total === 0
        ? say(
            `I can't see any vehicle of ${subject} followed live right now.`,
            `Ahora no veo ningún vehículo de ${subject} en seguimiento en directo.`,
          )
        : say(
            `Vehicles of ${subject} followed live now: ${String(total)}; the soonest at their next ` +
              'stop first:',
            `Vehículos de ${subject} en seguimiento en directo: ${String(total)}; primero, los más ` +
              'próximos a su siguiente parada:',
          );
  return {
    kind: 'where-is',
    subject,
    level: vehicles === null ? 'unknown' : 'info',
    headline,
    items: (vehicles ?? []).map((vehicle) => ({
      text: vehicleText(vehicle, told),
      at: vehicle.dataTime,
    })),
  };
}

function vehicleText(vehicle: VehicleFact, told: Telling): string {
  const { say } = told;
  const name = vehicle.name === null ? '' : ` ${vehicle.name}`;
  const margin =
    vehicle.marginMeters === null ? '' : ` (±${String(Math.round(vehicle.marginMeters))} m)`;
  const at = when(vehicle.dataTime, told);
  const where = whereText(vehicle, at, margin, told);
  const next =
    vehicle.next === null
      ? ''
      : vehicle.next.at === null
        ? say(` Next stop: ${vehicle.next.name}.`, ` Siguiente parada: ${vehicle.next.name}.`)
        : say(
            ` Next stop: ${vehicle.next.name} at ${when(vehicle.next.at, told)}.`,
            ` Siguiente parada: ${vehicle.next.name} a las ${when(vehicle.next.at, told)}.`,
          );
  return `${vehicle.line}${name} ${say('to', 'hacia')} ${vehicle.destination}: ${where}${next}`;
}

/** Where it is and on what that rests, as the four labels of Explore say it. */
function whereText(vehicle: VehicleFact, at: string, margin: string, { say }: Telling): string {
  const { station } = vehicle;
  if (station !== null) {
    const place =
      station.status === 'stopped'
        ? say(`at ${station.name}`, `en ${station.name}`)
        : station.status === 'arriving'
          ? say(`arriving at ${station.name}`, `llegando a ${station.name}`)
          : say(`on its way to ${station.name}`, `de camino a ${station.name}`);
    return say(
      `${place}, placed by the MTA's predictions of ${at}.`,
      `${place}, situado con las predicciones de la MTA de las ${at}.`,
    );
  }
  switch (vehicle.basis) {
    case 'gps':
      return say(`GPS position of ${at}${margin}.`, `posición GPS de las ${at}${margin}.`);
    case 'gps-plus':
      return say(
        `estimated from its GPS of ${at}${margin}.`,
        `estimada desde su GPS de las ${at}${margin}.`,
      );
    case 'scheduled':
      return say('placed by its timetable only.', 'situado solo con su horario.');
    case 'predicted':
      return say(
        `placed by the MTA's predictions of ${at}.`,
        `situado con las predicciones de la MTA de las ${at}.`,
      );
    case 'multilateration':
    case 'radar':
      return say(`position of ${at}${margin}.`, `posición de las ${at}${margin}.`);
  }
}

export function stationAccessCard(finding: StationAccess, told: Telling): Card {
  const { say } = told;
  const [only] = finding.stations;
  if (only === undefined || finding.stations.length > 1) {
    const n = String(finding.stations.length);
    return {
      kind: 'station-access',
      subject: finding.subject,
      level: 'info',
      headline: say(
        `${n} stations match "${finding.subject}". Tell me which one if you mean only one:`,
        `Hay ${n} estaciones que encajan con «${finding.subject}». Dime cuál si te refieres a una:`,
      ),
      items: finding.stations.map((station) => ({ text: stationSummary(station, told), at: null })),
    };
  }
  return {
    kind: 'station-access',
    subject: only.name,
    level: only.outagesNow === null ? 'unknown' : only.outagesNow.length > 0 ? 'notice' : 'clear',
    headline: outagesHeadline(only, told),
    items: stationItems(only, told).slice(0, 8),
  };
}

function outagesHeadline(station: StationFact, { say }: Telling): string {
  const { name, outagesNow } = station;
  if (outagesNow === null) {
    return say(
      `I can't check the elevators and escalators of ${name} right now.`,
      `Ahora no puedo comprobar los ascensores y escaleras mecánicas de ${name}.`,
    );
  }
  if (outagesNow.length === 0) {
    return say(
      `The MTA lists no elevator or escalator out of service at ${name}.`,
      `La MTA no da ningún ascensor ni escalera mecánica fuera de servicio en ${name}.`,
    );
  }
  const elevators = outagesNow.filter((outage) => outage.kind === 'elevator').length;
  const escalators = outagesNow.length - elevators;
  const parts = [
    elevators === 0
      ? ''
      : say(counted(elevators, 'elevator'), counted(elevators, 'ascensor', 'ascensores')),
    escalators === 0
      ? ''
      : say(
          counted(escalators, 'escalator'),
          counted(escalators, 'escalera mecánica', 'escaleras mecánicas'),
        ),
  ].filter((part) => part !== '');
  return say(
    `At ${name}, out of service now: ${parts.join(' and ')}.`,
    `En ${name}, fuera de servicio ahora: ${parts.join(' y ')}.`,
  );
}

/** "1 elevator", "2 elevators", "1 ascensor", "2 ascensores". */
const counted = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

function stationItems(station: StationFact, told: Telling): Item[] {
  const { say } = told;
  const items: Item[] = (station.outagesNow ?? []).map((outage) => ({
    text: outageText(outage, told),
    at: outage.since,
  }));
  for (const outage of station.announced ?? []) {
    items.push({
      text: say(
        `Announced from ${when(outage.since, told)}: ${outageText(outage, told)}`,
        `Anunciado desde las ${when(outage.since, told)}: ${outageText(outage, told)}`,
      ),
      at: outage.since,
    });
  }
  items.push({ text: accessText(station, told), at: null });
  if (station.ada !== 'none') {
    items.push({
      text: say(
        'An accessible station does not guarantee the whole route: check every station of your trip.',
        'Que una estación sea accesible no garantiza todo el itinerario: comprueba cada estación del viaje.',
      ),
      at: null,
    });
  }
  return items;
}

/** Step-free access by direction, as the MTA stations list gives it, with its note. */
function accessText(station: StationFact, { say }: Telling): string {
  const note =
    station.note === null
      ? ''
      : say(` MTA note: ${station.note}.`, ` Nota de la MTA: ${station.note}.`);
  if (station.ada === 'none')
    return say('Not step-free, by the MTA.', 'No es accesible sin escalones, según la MTA.') + note;
  if (station.northbound && station.southbound) {
    return (
      say(
        'Step-free in both directions, by the MTA.',
        'Sin escalones en los dos sentidos, según la MTA.',
      ) + note
    );
  }
  return station.northbound
    ? say(
        'Step-free northbound only, by the MTA.',
        'Sin escalones solo en sentido norte, según la MTA.',
      ) + note
    : say(
        'Step-free southbound only, by the MTA.',
        'Sin escalones solo en sentido sur, según la MTA.',
      ) + note;
}

function stationSummary(station: StationFact, told: Telling): string {
  const { say } = told;
  const lines = station.lines.length === 0 ? '' : ` (${station.lines.join(' ')})`;
  const out =
    station.outagesNow === null
      ? say('elevators not known now', 'ascensores sin comprobar ahora')
      : say(
          `${String(station.outagesNow.length)} out of service now`,
          `${String(station.outagesNow.length)} fuera de servicio ahora`,
        );
  const access =
    station.ada === 'none'
      ? say('not step-free', 'no accesible sin escalones')
      : station.ada === 'full'
        ? say('step-free', 'sin escalones')
        : say('step-free in one direction', 'sin escalones en un sentido');
  return `${station.name}${lines}: ${access}; ${out}.`;
}

const BANDS = {
  night: ['at night (0–6 h)', 'de madrugada (0–6 h)'],
  'am-peak': ['in the morning peak (6–10 h)', 'en la punta de la mañana (6–10 h)'],
  midday: ['at midday (10–16 h)', 'a mediodía (10–16 h)'],
  'pm-peak': ['in the evening peak (16–20 h)', 'en la punta de la tarde (16–20 h)'],
  evening: ['in the evening (20–24 h)', 'por la noche (20–24 h)'],
} as const;

const DAY_TYPES = {
  weekday: ['a weekday', 'un día laborable'],
  saturday: ['a Saturday', 'un sábado'],
  sunday: ['a Sunday', 'un domingo'],
} as const;

export function reliabilityCard(finding: Reliability, told: Telling): Card {
  const { say } = told;
  const line = routeName(finding.route, say);
  const { measured } = finding;
  if (measured === null) {
    return {
      kind: 'line-reliability',
      subject: finding.route.label,
      level: 'unknown',
      headline: say(
        `There is not enough data yet to say how ${line} usually runs at this time.`,
        `Aún no hay datos suficientes para decir cómo suele ir ${line} a esta hora.`,
      ),
      items: [],
    };
  }
  const [bandEn, bandEs] = BANDS[measured.band];
  const [dayEn, dayEs] = DAY_TYPES[measured.dayType];
  const band = say(bandEn, bandEs);
  const dayType = say(dayEn, dayEs);
  return {
    kind: 'line-reliability',
    subject: finding.route.label,
    level: 'info',
    headline: say(
      `Measured by MovIQ on ${measured.day}, ${dayType}, ${band}:`,
      `Medido por MovIQ el ${measured.day}, ${dayType}, ${band}:`,
    ),
    items: [
      ...measured.headways.map((headway) => ({ text: headwayText(headway, told), at: null })),
      {
        text: say(
          `Stoppages observed in that band: ${String(measured.stoppages)}.`,
          `Parones observados en esa franja: ${String(measured.stoppages)}.`,
        ),
        at: null,
      },
    ],
  };
}

function headwayText(headway: HeadwayFact, { say }: Telling): string {
  const [p50, p90, n, bunched] = [
    minutes(headway.p50Seconds),
    minutes(headway.p90Seconds),
    String(headway.n),
    String(headway.bunched),
  ];
  return say(
    `Direction ${headway.direction}: one every ${p50} min at the median, ${p90} min at the 90th ` +
      `percentile, over ${n} intervals; ${bunched} came bunched.`,
    `Sentido ${headway.direction}: uno cada ${p50} min de mediana y ${p90} min en el percentil 90, ` +
      `en ${n} intervalos; ${bunched} llegaron agrupados.`,
  );
}
