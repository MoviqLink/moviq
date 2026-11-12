import type { Journey, TravelMode } from '@moviq/contracts';

import { useLang } from '../../shared/i18n/lang';
import type { PlatformAccess } from './model/step-free';

type Reason = NonNullable<Journey['watch']['stepFreeRefusal']>['reason'];
type Cause = NonNullable<PlatformAccess['cause']>;

const list = (items: readonly string[], and: string): string =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1) ?? ''}`;

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const modesEn: Record<TravelMode, string> = {
  walk: 'walks',
  subway: 'the subway',
  bus: 'buses',
  rail: 'trains',
  ferry: 'ferries',
  taxi: 'taxis',
};

const modesEs: Record<TravelMode, string> = {
  walk: 'los trayectos a pie',
  subway: 'el metro',
  bus: 'los autobuses',
  rail: 'los trenes',
  ferry: 'los ferris',
  taxi: 'los taxis',
};

// The step-free words of the trip. Spanish has exactly the same keys: TypeScript checks it.
export const stepFreeEn = {
  title: 'Step-free',
  lead: {
    clear: (time: string) =>
      `Stations step-free according to the MTA, with no elevator outage reported at ${time}.`,
    'elevator-out': (station: string, elevator: string | null) => {
      const which = elevator === null ? 'an elevator' : `elevator ${elevator}`;
      return `Not step-free right now: the MTA reports ${which} out of service at ${station}.`;
    },
    'not-step-free': (station: string) =>
      'Not step-free right now: the MTA station list gives no step-free access ' +
      `at ${station} for this platform.`,
    unconfirmed: (station: string) => `Step-free access at ${station} cannot be confirmed now.`,
    'walk-unchecked': (step: number) =>
      `Step-free access is not checked on step ${String(step)}: that walk was not walked on the ` +
      'streets with a wheelchair.',
    unchecked:
      'We can’t check the elevators now: the MTA lists are not available, so step-free access ' +
      'is not confirmed.',
    'not-checked': 'Step-free access was not checked for this route when it was planned.',
  },
  refused: (reason: string) => `We can’t guarantee a step-free trip right now: ${reason}.`,
  reasons: {
    'lists-unavailable': 'the MTA lists of accessible stations and elevators are not available',
    'outage-unplaced': 'the MTA reports an elevator out that we cannot place on a station',
    'modes-without-data':
      'the timetables of the modes you chose do not say which stops are step-free',
  } satisfies Record<Reason, string>,
  board: (line: string) => `Board the ${line}`,
  alight: (line: string) => `Get off the ${line}`,
  states: {
    accessible: 'Step-free',
    'one-direction': 'This direction only',
    'elevator-out': 'Elevator out',
    'not-step-free': 'No step-free access',
    unknown: 'Not verified',
  } satisfies Record<PlatformAccess['state'], string>,
  elevator: (id: string, serving: string | null) => (serving === null ? id : `${id} · ${serving}`),
  outSince: (time: string) => `out since ${time}`,
  announced: (time: string) => `announced from ${time}`,
  back: (time: string) => `back about ${time} (MTA estimate)`,
  causes: {
    outage: 'An elevator of this station is out',
    'not-in-service': 'The MTA inventory lists an elevator here as not in service',
    inactive: 'The MTA equipment list marks an elevator here as inactive',
    note: 'The MTA station list has a note this check cannot read',
    'not-listed': 'Not in the MTA station list',
    'not-step-free': 'The MTA station list gives this platform no step-free access',
    'lists-unavailable': 'The MTA lists are not available',
    'outage-unplaced': 'An elevator out cannot be placed on a station',
  } satisfies Record<Cause, string>,
  change: (from: string, to: string) =>
    'The MTA does not publish the routes inside stations: the change ' +
    `${from === to ? `at ${from}` : `from ${from} to ${to}`} is not verified.`,
  modesLeftOut: (modes: readonly TravelMode[]) =>
    `${upper(
      list(
        modes.map((mode) => modesEn[mode]),
        'and',
      ),
    )} were left out: their timetables ` + 'do not say which stops are step-free.',
  walk: (step: number) =>
    `Step-free access not checked on this walk (step ${String(step)}): it is estimated, not ` +
    'walked on the streets with a wheelchair.',
  entrance: (station: string) =>
    `The MTA’s 2024 entrance survey lists no elevator or ramp at ${station}: the walk is ` +
    'measured to the station, and the accessible entrance is not checked.',
  source: (state: string, age: string) => `MTA elevator outages · ${state} · data from ${age} ago`,
  sourceNoAge: (state: string) => `MTA elevator outages · ${state} · no data`,
};

export type StepFreeDict = typeof stepFreeEn;

export const stepFreeEs: StepFreeDict = {
  title: 'Sin escalones',
  lead: {
    clear: (time: string) =>
      `Estaciones accesibles según la MTA y sin averías de ascensor comunicadas a las ${time}.`,
    'elevator-out': (station: string, elevator: string | null) => {
      const which = elevator === null ? 'un ascensor' : `el ascensor ${elevator}`;
      return `Ahora no es sin escalones: la MTA comunica averiado ${which} en ${station}.`;
    },
    'not-step-free': (station: string) =>
      'Ahora no es sin escalones: la lista de estaciones de la MTA no da acceso sin escalones ' +
      `a este andén de ${station}.`,
    unconfirmed: (station: string) =>
      `No podemos confirmar ahora el acceso sin escalones en ${station}.`,
    'walk-unchecked': (step: number) =>
      `Accesibilidad sin comprobar en el paso ${String(step)}: ese tramo a pie no se ha ` +
      'recorrido por la calle en silla de ruedas.',
    unchecked:
      'No podemos comprobar ahora los ascensores: las listas de la MTA no están disponibles, ' +
      'así que el acceso sin escalones no está confirmado.',
    'not-checked': 'El acceso sin escalones de esta ruta no se comprobó al planificarla.',
  },
  refused: (reason: string) => `No podemos garantizar un viaje sin escalones ahora: ${reason}.`,
  reasons: {
    'lists-unavailable':
      'las listas de estaciones accesibles y ascensores de la MTA no están disponibles',
    'outage-unplaced':
      'la MTA comunica un ascensor averiado que no podemos situar en ninguna estación',
    'modes-without-data':
      'los horarios de los medios que elegiste no dicen qué paradas no tienen escalones',
  },
  board: (line: string) => `Subes al ${line}`,
  alight: (line: string) => `Bajas del ${line}`,
  states: {
    accessible: 'Sin escalones',
    'one-direction': 'Solo en este sentido',
    'elevator-out': 'Ascensor averiado',
    'not-step-free': 'Sin acceso sin escalones',
    unknown: 'Sin comprobar',
  },
  elevator: (id: string, serving: string | null) => (serving === null ? id : `${id} · ${serving}`),
  outSince: (time: string) => `averiado desde las ${time}`,
  announced: (time: string) => `anunciado desde las ${time}`,
  back: (time: string) => `vuelta hacia las ${time} (estimación de la MTA)`,
  causes: {
    outage: 'Hay un ascensor averiado en esta estación',
    'not-in-service': 'El inventario de la MTA da un ascensor de aquí fuera de servicio',
    inactive: 'La lista de equipos de la MTA marca inactivo un ascensor de aquí',
    note: 'La lista de estaciones de la MTA trae una nota que esta comprobación no puede leer',
    'not-listed': 'No figura en la lista de estaciones de la MTA',
    'not-step-free': 'La lista de estaciones de la MTA no da a este andén acceso sin escalones',
    'lists-unavailable': 'Las listas de la MTA no están disponibles',
    'outage-unplaced': 'Hay un ascensor averiado que no se puede situar en ninguna estación',
  },
  change: (from: string, to: string) =>
    'La MTA no publica los recorridos dentro de las estaciones: el transbordo ' +
    `${from === to ? `en ${from}` : `de ${from} a ${to}`} no está comprobado.`,
  modesLeftOut: (modes: readonly TravelMode[]) =>
    `${upper(
      list(
        modes.map((mode) => modesEs[mode]),
        'y',
      ),
    )} quedan fuera: sus horarios no ` + 'dicen qué paradas no tienen escalones.',
  walk: (step: number) =>
    `Accesibilidad sin comprobar en este tramo (paso ${String(step)}): es una estimación, no ` +
    'se ha recorrido por la calle en silla de ruedas.',
  entrance: (station: string) =>
    `El censo de entradas de la MTA de 2024 no recoge ascensor ni rampa en ${station}: la ` +
    'caminata se mide hasta la estación y la entrada accesible no está comprobada.',
  source: (state: string, age: string) =>
    `Averías de ascensores de la MTA · ${state} · datos de hace ${age}`,
  sourceNoAge: (state: string) => `Averías de ascensores de la MTA · ${state} · sin datos`,
};

/** The step-free words in the language in use. */
export function useStepFreeT(): StepFreeDict {
  return useLang() === 'es' ? stepFreeEs : stepFreeEn;
}
