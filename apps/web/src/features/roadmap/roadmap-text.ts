import type { Lang } from '../../shared/i18n/lang';

export type RoadmapMode = 'walk' | 'subway' | 'bus' | 'rail' | 'ferry' | 'other';

/** One leg of the trip as the roadmap draws it: a bar from `start` to `end`. */
export interface RoadmapLeg {
  readonly id: string;
  /** What the leg is, in the reader's language: "Subway", "Walk", "Transfer"… */
  readonly name: string;
  readonly mode: RoadmapMode;
  readonly line: string | null;
  readonly from: string;
  readonly to: string;
  readonly start: Date;
  readonly end: Date;
}

const MODE_NAMES: Readonly<Record<RoadmapMode, Readonly<Record<Lang, string>>>> = {
  walk: { en: 'Walk', es: 'A pie' },
  subway: { en: 'Subway', es: 'Metro' },
  bus: { en: 'Bus', es: 'Autobús' },
  rail: { en: 'Rail', es: 'Tren' },
  ferry: { en: 'Ferry', es: 'Ferri' },
  other: { en: 'Car', es: 'Coche' },
};

/** Every word the roadmap shows, in the two languages of MovIQ. */
export const ROADMAP_TEXT = {
  en: {
    title: 'Trip roadmap',
    chart: 'Trip roadmap: each leg of the journey on New York time',
    leg: 'Leg',
    line: 'Line',
    route: 'From → to',
    minutes: 'Min',
    transfer: 'Transfer',
    now: 'Now',
    timeZone: 'New York time',
    minutesTaken: (minutes: number) => `${String(minutes)} min`,
    changeTo: (line: string) => `Change to the ${line}`,
    changeFrom: (line: string) => `Change from the ${line}`,
  },
  es: {
    title: 'Hoja de ruta del viaje',
    chart: 'Hoja de ruta: cada tramo del viaje en hora de Nueva York',
    leg: 'Tramo',
    line: 'Línea',
    route: 'De → a',
    minutes: 'Min',
    transfer: 'Transbordo',
    now: 'Ahora',
    timeZone: 'Hora de Nueva York',
    minutesTaken: (minutes: number) => `${String(minutes)} min`,
    changeTo: (line: string) => `Cambio a la línea ${line}`,
    changeFrom: (line: string) => `Cambio desde la línea ${line}`,
  },
} as const;

export const modeName = (mode: RoadmapMode, lang: Lang): string => MODE_NAMES[mode][lang];
