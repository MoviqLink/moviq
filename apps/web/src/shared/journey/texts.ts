import { useLang } from '../i18n/lang';

const s = String;

// Words for legs and times, shared by the planner and the trip. Spanish has the same keys.
export const journeyEn = {
  modes: {
    walk: 'Walk',
    subway: 'Subway',
    bus: 'Bus',
    rail: 'Train',
    ferry: 'Ferry',
    taxi: 'Taxi',
  },
  timing: {
    realtime: 'live',
    scheduled: 'timetable',
    estimated: 'estimated',
  },
  timingHint: {
    realtime: 'A live prediction from the operator.',
    scheduled: 'From the published timetable.',
    estimated: 'Walking or road time, estimated.',
  },
  walkTo: (place: string) => `Walk to ${place}`,
  toward: (headsign: string) => `towards ${headsign}`,
  from: (place: string) => `From ${place}`,
  arrive: (place: string) => `Arrive at ${place}`,
  minutes: (n: number) => `${s(n)} min`,
  liveAge: (age: string) => `live · ${age}`,
  source: (id: string, state: string, age: string) => `Source: ${id} · ${state} · ${age} old`,
  sourceNoAge: (id: string, state: string) => `Source: ${id} · ${state}`,
  planned: (time: string) => `Planned ${time}`,
  steps: 'Steps of the trip',
  walk: {
    street: 'walk, on the streets',
    'station-rule': 'change, station time',
    estimated: 'walk, estimated',
    change: 'change not checked',
  },
  walkHint: {
    street: 'Walked on OpenStreetMap streets by Transitous.',
    'station-rule': 'The time the operator sets for this change inside the station.',
    estimated: 'Estimated from the straight line: not checked on the streets.',
    change:
      'Estimated from the straight line: not checked on the streets, so this change may not make the next ride.',
  },
  provisional: 'Provisional: some walks are estimated, not checked on the streets.',
  about: (text: string) => `about ${text}`,
};

export type JourneyDict = typeof journeyEn;

export const journeyEs: JourneyDict = {
  modes: {
    walk: 'A pie',
    subway: 'Metro',
    bus: 'Bus',
    rail: 'Tren',
    ferry: 'Ferri',
    taxi: 'Taxi',
  },
  timing: {
    realtime: 'en directo',
    scheduled: 'según horario',
    estimated: 'estimada',
  },
  timingHint: {
    realtime: 'Una predicción en directo del operador.',
    scheduled: 'Del horario publicado.',
    estimated: 'Tiempo a pie o por carretera, estimado.',
  },
  walkTo: (place: string) => `A pie hasta ${place}`,
  toward: (headsign: string) => `dirección ${headsign}`,
  from: (place: string) => `Desde ${place}`,
  arrive: (place: string) => `Llegada a ${place}`,
  minutes: (n: number) => `${s(n)} min`,
  liveAge: (age: string) => `en directo · ${age}`,
  source: (id: string, state: string, age: string) => `Fuente: ${id} · ${state} · de hace ${age}`,
  sourceNoAge: (id: string, state: string) => `Fuente: ${id} · ${state}`,
  planned: (time: string) => `Previsto ${time}`,
  steps: 'Pasos del viaje',
  walk: {
    street: 'a pie, por la calle',
    'station-rule': 'transbordo, tiempo de la estación',
    estimated: 'a pie, estimado',
    change: 'transbordo sin comprobar',
  },
  walkHint: {
    street: 'Recorrido por las calles de OpenStreetMap con Transitous.',
    'station-rule': 'El tiempo que fija el operador para este transbordo dentro de la estación.',
    estimated: 'Estimado en línea recta: sin comprobar por la calle.',
    change:
      'Estimado en línea recta: sin comprobar por la calle, así que este transbordo puede no ' +
      'llegar al siguiente vehículo.',
  },
  provisional: 'Provisional: hay tramos a pie estimados, sin comprobar por la calle.',
  about: (text: string) => `unos ${text}`,
};

/** Leg and time words in the language in use. */
export function useJourneyT(): JourneyDict {
  return useLang() === 'es' ? journeyEs : journeyEn;
}
