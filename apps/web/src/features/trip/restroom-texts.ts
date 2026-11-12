import type { RestroomAccess } from '@moviq/contracts';

import { useLang } from '../../shared/i18n/lang';

const s = String;

// The words of "Restroom on the way". Spanish has exactly the same keys: TypeScript checks it.
export const restroomEn = {
  title: 'Restroom on the way',
  lead: 'Free public restrooms in service near your next stops.',
  stepFree: 'Your trip is step-free: the fully accessible ones come first.',
  looking: 'Looking for restrooms near your next stops…',
  failed: 'The restrooms did not load.',
  retry: 'Try again',
  unreadable: 'The city’s list of restrooms can’t be read now, so we can’t say which are near.',
  none: (metres: number) =>
    `No public restroom in service within ${s(metres)} m in a straight line of your next stops.`,
  near: (stop: string) => `Near ${stop}`,
  metres: (metres: number) => `${s(metres)} m`,
  straight: 'in a straight line',
  hours: 'Hours as published',
  noHours: 'No hours published',
  seasonal: 'Seasonal',
  access: {
    full: 'Fully accessible',
    partial: 'Partly accessible',
    limited: 'Limited accessibility',
    none: 'Not accessible',
  } satisfies Record<RestroomAccess, string>,
  accessUnknown: 'Accessibility not given',
  key: 'Key or code needed: ask there',
  official: 'Official page',
  source: (title: string, age: string) => `${title} · NYC Open Data · read ${age} ago`,
  sourceNoAge: (title: string) => `${title} · NYC Open Data · no data`,
};

export type RestroomDict = typeof restroomEn;

export const restroomEs: RestroomDict = {
  title: 'Aseo en el camino',
  lead: 'Aseos públicos gratuitos y en servicio cerca de tus próximas paradas.',
  stepFree: 'Tu viaje es sin escalones: primero van los totalmente accesibles.',
  looking: 'Buscando aseos cerca de tus próximas paradas…',
  failed: 'Los aseos no se han cargado.',
  retry: 'Reintentar',
  unreadable:
    'Ahora no se puede leer la lista de aseos de la ciudad, así que no podemos decir cuáles están cerca.',
  none: (metres) =>
    `No hay ningún aseo público en servicio a menos de ${s(metres)} m en línea recta de tus próximas paradas.`,
  near: (stop) => `Cerca de ${stop}`,
  metres: (metres) => `${s(metres)} m`,
  straight: 'en línea recta',
  hours: 'Horario publicado, en inglés',
  noHours: 'Sin horario publicado',
  seasonal: 'De temporada',
  access: {
    full: 'Totalmente accesible',
    partial: 'Parcialmente accesible',
    limited: 'Accesibilidad limitada',
    none: 'No accesible',
  },
  accessUnknown: 'Accesibilidad no indicada',
  key: 'Hace falta llave o código: pregunta allí',
  official: 'Página oficial',
  source: (title, age) => `${title} · NYC Open Data · leída hace ${age}`,
  sourceNoAge: (title) => `${title} · NYC Open Data · sin datos`,
};

/** The words of "Restroom on the way" in the language in use. */
export function useRestroomT(): RestroomDict {
  return useLang() === 'es' ? restroomEs : restroomEn;
}
