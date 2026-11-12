import { z } from 'zod';

import { routeOf } from '../city/lines.js';
import type { Lang } from './state.js';
import { defineTool, type AssistantTool } from './tool.js';

/** What came of asking Sara to watch a line: told with fixed words, never with the model's. */
export interface WatchNote {
  readonly outcome: 'created' | 'exists' | 'limit' | 'unknown-line' | 'unavailable';
  /** The line as MovIQ names it, or the words the traveller used when it is not one. */
  readonly line: string;
}

const WORDS: Readonly<
  Record<Lang, Readonly<Record<WatchNote['outcome'], (line: string) => string>>>
> = {
  en: {
    created: (line) =>
      `Done. I am now watching ${line} for you. It is below, under “Sara watches for you”, ` +
      'and I will leave a notice there when a published alert clears.',
    exists: (line) => `I am already watching ${line} for you. It is below, with its state.`,
    limit: () => 'You already have ten watches. Remove one below and ask me again.',
    'unknown-line': (line) =>
      `I do not know a line called “${line}”. Tell me a subway line, a bus route or PATH.`,
    unavailable: () => 'I cannot start watches from this conversation right now.',
  },
  es: {
    created: (line) =>
      `Hecho. Ya vigilo ${line} por ti. La tienes abajo, en «Sara vigila por ti», y te dejaré ` +
      'allí un aviso cuando se resuelva una alerta publicada.',
    exists: (line) => `Ya estoy vigilando ${line} por ti. La tienes abajo, con su estado.`,
    limit: () => 'Ya tienes diez vigilancias. Quita una abajo y vuelve a pedírmelo.',
    'unknown-line': (line) =>
      `No conozco ninguna línea llamada «${line}». Dime una línea de metro, una ruta de autobús o PATH.`,
    unavailable: () => 'Ahora mismo no puedo activar vigilancias desde esta conversación.',
  },
};

export function watchReply(note: WatchNote, lang: Lang): string {
  return WORDS[lang][note.outcome](note.line);
}

/** How a subway line reads in a sentence: "the 7 line"; a bus route and PATH go by their name. */
function spoken(label: string, mode: string, lang: Lang): string {
  if (mode !== 'subway') return label;
  return lang === 'es' ? `la línea ${label}` : `the ${label} line`;
}

/**
 * Sara starts a watch when asked in plain words: the same watch the traveller can add by hand
 * on the Agent screen, checked by the worker against the published alerts.
 */
export const watchTools: readonly AssistantTool[] = [
  defineTool(
    'watch_line',
    'Starts watching a subway line, a bus route or PATH for the traveller: its published ' +
      'alerts are checked from now on and a notice is left when one clears. Use it when they ' +
      'ask you to watch, monitor, follow or keep an eye on a line.',
    z.strictObject({ route: z.string().trim().min(1).max(40) }),
    async (input, ports, turn) => {
      const route = routeOf(input.route);
      if (route === undefined) {
        turn.watch = { outcome: 'unknown-line', line: input.route };
      } else if (ports.watches === undefined) {
        turn.watch = { outcome: 'unavailable', line: route.label };
      } else {
        const outcome = await ports.watches.watchLine(turn.travellerId, route.label);
        turn.watch = { outcome, line: spoken(route.label, route.mode, turn.lang) };
      }
      return { watch: turn.watch.outcome };
    },
  ),
];
