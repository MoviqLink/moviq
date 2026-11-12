import type { RestroomAccess } from '@moviq/contracts';

import type { Finding, RestroomFact } from './findings.js';
import type { Card, Telling } from './words-common.js';

type Restrooms = Extract<Finding, { kind: 'restrooms' }>;

const ACCESS: Readonly<Record<RestroomAccess, readonly [en: string, es: string]>> = {
  full: ['Fully accessible.', 'Totalmente accesible.'],
  partial: ['Partly accessible.', 'Parcialmente accesible.'],
  limited: ['Limited accessibility.', 'Accesibilidad limitada.'],
  none: ['Not accessible.', 'No accesible.'],
};
const NOT_GIVEN = ['Accessibility not given.', 'Accesibilidad no indicada.'] as const;

function headline(finding: Restrooms, { say }: Telling): string {
  const { restrooms, subject, withinMetres } = finding;
  const trip = finding.scope === 'trip';
  if (restrooms === null) {
    return say(
      "I can't read the city's list of public restrooms right now.",
      'Ahora no puedo leer la lista de aseos públicos de la ciudad.',
    );
  }
  const within = String(withinMetres);
  if (restrooms.length === 0) {
    return trip
      ? say(
          `No public restroom in service within ${within} m in a straight line of your next ` +
            `stops (${subject}).`,
          `No hay ningún aseo público en servicio a menos de ${within} m en línea recta de tus ` +
            `próximas paradas (${subject}).`,
        )
      : say(
          `No public restroom in service within ${within} m in a straight line of ${subject}.`,
          `No hay ningún aseo público en servicio a menos de ${within} m en línea recta de ` +
            `${subject}.`,
        );
  }
  const found = trip
    ? say(
        `Free public restrooms near your next stops (${subject}), in a straight line:`,
        `Aseos públicos gratuitos cerca de tus próximas paradas (${subject}), en línea recta:`,
      )
    : say(
        `Free public restrooms near ${subject}, in a straight line:`,
        `Aseos públicos gratuitos cerca de ${subject}, en línea recta:`,
      );
  return finding.stepFree
    ? `${found} ${say(
        'Your trip is step-free, so the fully accessible ones come first.',
        'Tu viaje es sin escalones: primero van los totalmente accesibles.',
      )}`
    : found;
}

function restroomText(restroom: RestroomFact, { say }: Telling): string {
  const metres = String(restroom.straightMetres);
  const hours =
    restroom.hours === null
      ? say('No hours published.', 'Sin horario publicado.')
      : say(
          `Hours as published: ${restroom.hours.split('\n').join('; ')}.`,
          `Horario publicado, en inglés: ${restroom.hours.split('\n').join('; ')}.`,
        );
  const parts = [
    say(
      `${restroom.name}: ${metres} m in a straight line from ${restroom.near}.`,
      `${restroom.name}: a ${metres} m en línea recta de ${restroom.near}.`,
    ),
    say(...(restroom.access === null ? NOT_GIVEN : ACCESS[restroom.access])),
    hours,
  ];
  if (restroom.season === 'seasonal') {
    parts.push(say('Open part of the year only.', 'Solo abre parte del año.'));
  }
  if (restroom.keyOrCode) {
    parts.push(
      say('A key or a code is needed: ask there.', 'Hace falta llave o código: pregunta allí.'),
    );
  }
  return parts.join(' ');
}

/** The restrooms found near the trip, a station or a place: free, straight line, hours as given. */
export function restroomsCard(finding: Restrooms, told: Telling): Card {
  return {
    kind: 'restrooms',
    subject: finding.subject,
    level: finding.restrooms === null ? 'unknown' : 'info',
    headline: headline(finding, told),
    items: (finding.restrooms ?? []).map((restroom) => ({
      text: restroomText(restroom, told),
      at: null,
    })),
  };
}
