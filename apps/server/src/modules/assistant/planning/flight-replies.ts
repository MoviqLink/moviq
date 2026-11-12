import type { Flight } from '@moviq/contracts';

import { deadlineFor, plannedDeparture } from '../../journeys/flight-deadline.js';
import { flightLabel } from '../understanding/flight-number.js';
import type { BoardingPassDraft, Lang, Note } from './state.js';
import { day, time, type Words } from './words.js';

const FLIGHT_NOTES = [
  'flight-found',
  'boarding-pass-used',
  'flight-not-found',
  'flights-unavailable',
  'no-boarding-pass-flight',
] as const;

export type FlightNoteKind = (typeof FLIGHT_NOTES)[number];
type FlightNote = Extract<Note, { kind: FlightNoteKind }>;

export function isFlightNote(note: Note): note is FlightNote {
  return (FLIGHT_NOTES as readonly string[]).includes(note.kind);
}

/** What Sara says of a flight found, read from a boarding pass, or not found. */
export function flightSentence(note: FlightNote, say: Words, lang: Lang, now: Date): string {
  switch (note.kind) {
    case 'flight-found':
      return foundSentence(note.flight, say, lang, now);
    case 'boarding-pass-used': {
      const { flight } = note;
      const departs = new Date(flight.departureAt);
      const deadline = time(deadlineFor(departs), lang);
      const at = `${time(departs, lang)}${day(departs, lang, now)}`;
      const where = `${flight.airport}${flight.terminal === null ? '' : `, terminal ${flight.terminal}`}`;
      return say(
        `I plan from the ${at} departure on your boarding pass, from ${where}: be at the airport by ${deadline}.`,
        `Planifico con la salida de las ${at} de tu tarjeta de embarque, desde ${where}: tienes que ` +
          `estar en el aeropuerto a las ${deadline}.`,
      );
    }
    case 'flight-not-found':
      return say(
        `I could not find flight ${note.flight} leaving New York on ${note.date}.`,
        `No encuentro el vuelo ${note.flight} con salida de Nueva York el ${note.date}.`,
      );
    case 'flights-unavailable':
      return note.why === 'allowance'
        ? say(
            "Flight lookups are paused until this month's free allowance renews, so I could not " +
              `look up ${note.flight}.`,
            'Las consultas de vuelos están en pausa hasta que se renueve el cupo gratuito de este ' +
              `mes, así que no he podido buscar el ${note.flight}.`,
          )
        : say(
            `Flight search is not answering right now, so I could not look up ${note.flight}.`,
            `La búsqueda de vuelos no responde ahora mismo, así que no he podido buscar el ${note.flight}.`,
          );
    case 'no-boarding-pass-flight':
      return say(
        'Tell me your flight number first, and I will look it up.',
        'Dime primero el número de vuelo y lo busco.',
      );
  }
}

function foundSentence(flight: Flight, say: Words, lang: Lang, now: Date): string {
  const departs = plannedDeparture(flight);
  const scheduled = new Date(flight.departureAt);
  const deadline = time(deadlineFor(departs), lang);
  const where =
    `${flight.airport}${flight.terminal === null ? '' : `, terminal ${flight.terminal}`}` +
    (flight.gate === null ? '' : say(`, gate ${flight.gate}`, `, puerta ${flight.gate}`));
  const at = `${time(departs, lang)}${day(departs, lang, now)}`;
  const moved = departs.getTime() !== scheduled.getTime();
  const revised = moved
    ? say(`, revised from ${time(scheduled, lang)}`, ` (antes, a las ${time(scheduled, lang)})`)
    : '';
  const name = flightLabel(flight.carrier, flight.number);
  return say(
    `Flight ${name} leaves ${where} at ${at}${revised}. I plan for you to be at the airport by ${deadline}.`,
    `El vuelo ${name} sale de ${where} a las ${at}${revised}. Planifico que estés en el aeropuerto a las ${deadline}.`,
  );
}

/** The question for a flight waiting for its boarding pass: what is still missing of it. */
export function boardingPassQuestion(pass: BoardingPassDraft, say: Words): string {
  if (pass.departureAt === null && pass.airport === null) {
    return say(
      'What departure time does your boarding pass show, and from which airport: JFK, ' +
        'LaGuardia or Newark? Tell me the terminal too if you know it.',
      '¿Qué hora de salida pone tu tarjeta de embarque y de qué aeropuerto sale: JFK, LaGuardia ' +
        'o Newark? Si sabes la terminal, dímela también.',
    );
  }
  if (pass.departureAt === null) {
    return say(
      'What departure time does your boarding pass show? Tell me the terminal too if you know it.',
      '¿Qué hora de salida pone tu tarjeta de embarque? Si sabes la terminal, dímela también.',
    );
  }
  return say(
    'From which airport does it leave: JFK, LaGuardia or Newark?',
    '¿De qué aeropuerto sale: JFK, LaGuardia o Newark?',
  );
}
