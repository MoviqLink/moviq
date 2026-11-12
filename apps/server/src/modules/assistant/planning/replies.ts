import type { PlanResponse } from '@moviq/contracts';

import {
  boardingPassQuestion,
  flightSentence,
  isFlightNote,
  type FlightNoteKind,
} from './flight-replies.js';
import { missingSlots, type ConversationState, type Lang, type Note } from './state.js';
import { time, type Words } from './words.js';

/** Why a reply comes from the basic assistant; each reason is said in the reply. */
export type BasicReason = 'no-model' | 'budget' | 'model-failed' | 'privacy';

/** The fixed reply for the state of the conversation and what happened this turn. */
export function fixedReply(input: {
  readonly state: ConversationState;
  readonly notes: readonly Note[];
  readonly lang: Lang;
  readonly now: Date;
  readonly basic: BasicReason | undefined;
}): string {
  const { state, lang, now } = input;
  const say: Words = (en, es) => (lang === 'es' ? es : en);
  const sentences: string[] = [];
  if (input.basic !== undefined) sentences.push(basicNotice(input.basic, say));
  for (const note of input.notes) {
    const sentence = noteSentence(note, say, lang, now);
    // A turn that fell back to basic mode may meet the same fact twice: it is told once.
    if (sentence !== undefined && !sentences.includes(sentence)) sentences.push(sentence);
  }
  const planned = input.notes.some((note) => note.kind === 'planned');
  if (state.plan !== null && !planned) sentences.push(planSentence(state.plan, say, lang));
  if (
    state.plan === null &&
    !input.notes.some((note) => note.kind === 'airport-which' || note.kind === 'airport-confirm')
  )
    sentences.push(nextQuestion(state, say));
  return sentences.join(' ');
}

export function basicNotice(reason: BasicReason, say: Words): string {
  switch (reason) {
    case 'no-model':
      return say(
        'I am in basic mode because my AI is not connected, so I understand simple sentences ' +
          'such as "Bryant Park at 7 pm from 125th Street".',
        'Estoy en modo básico porque mi IA no está conectada, así que entiendo frases ' +
          'sencillas como «Bryant Park a las 7 de la tarde desde la calle 125».',
      );
    case 'budget':
      return say(
        "I am in basic mode because today's AI allowance is used up, so I understand simple sentences.",
        'Estoy en modo básico porque hoy ya se ha gastado el uso de IA previsto, así que entiendo frases sencillas.',
      );
    case 'model-failed':
      return say(
        'I am in basic mode for this answer because my AI did not give a valid one.',
        'Estoy en modo básico en esta respuesta porque mi IA no ha dado una válida.',
      );
    case 'privacy':
      return say(
        'I am in basic mode for this answer so that nothing personal is sent to my AI.',
        'Estoy en modo básico en esta respuesta para que no se envíe nada personal a mi IA.',
      );
  }
}

type ProblemNote = Exclude<
  Note,
  {
    kind:
      | 'airport-which'
      | 'airport-confirm'
      | 'place-found'
      | 'planned'
      | 'place-not-found'
      | 'places-unavailable'
      | FlightNoteKind;
  }
>;

function noteSentence(note: Note, say: Words, lang: Lang, now: Date): string | undefined {
  if (note.kind === 'airport-which')
    return say(
      'Which airport: JFK, LaGuardia or Newark?',
      '¿A qué aeropuerto vas: JFK, LaGuardia o Newark?',
    );
  if (note.kind === 'airport-confirm')
    return say(`Did you mean ${note.airport}?`, `¿Querías decir ${note.airport}?`);
  if (note.kind === 'place-found') return undefined;
  if (note.kind === 'planned') return planSentence(note.plan, say, lang);
  if (note.kind === 'place-not-found') {
    return say(
      `I could not find "${note.query}" in New York. Try a street address or a well-known place.`,
      `No encuentro «${note.query}» en Nueva York. Prueba con una dirección o un lugar conocido.`,
    );
  }
  if (note.kind === 'places-unavailable') {
    return say(
      `Address search is not answering right now, so I could not look up "${note.query}". ` +
        `Please try again in a moment.`,
      `La búsqueda de direcciones no responde ahora mismo, así que no he podido buscar ` +
        `«${note.query}». Vuelve a intentarlo en un momento.`,
    );
  }
  if (isFlightNote(note)) return flightSentence(note, say, lang, now);
  return problemSentence(note, say, lang);
}

function problemSentence(note: ProblemNote, say: Words, lang: Lang): string {
  switch (note.kind) {
    case 'flight-departed':
      return say(
        `Flight ${note.flight} has already left.`,
        `El vuelo ${note.flight} ya ha salido.`,
      );
    case 'airport-differs':
      return say(
        `Your flight leaves from ${note.actual}, not ${note.said}.`,
        `Tu vuelo sale de ${note.actual}, no de ${note.said}.`,
      );
    case 'airport-not-found':
      return say(
        `I could not find ${note.airport} in the address search, so I cannot plan the way there yet.`,
        `No encuentro ${note.airport} en la búsqueda de direcciones, así que aún no puedo planificar cómo llegar.`,
      );
    case 'time-passed':
      return say(
        `${time(new Date(note.at), lang)} has already passed in New York. When do you need to ` +
          `be there? You can say "tomorrow at 7 pm".`,
        `Las ${time(new Date(note.at), lang)} ya han pasado en Nueva York. ¿A qué hora tienes ` +
          `que llegar? Puedes decir «mañana a las 7 de la tarde».`,
      );
    case 'time-too-far':
      return say('I can plan up to a week ahead.', 'Puedo planificar hasta una semana vista.');
    case 'flight-sets-time':
      return say(
        'Your flight sets the time: I plan for you to be at the airport two hours before it leaves.',
        'Tu vuelo marca la hora: planifico que estés en el aeropuerto dos horas antes de la salida.',
      );
    case 'plan-failed':
      return say(
        'I could not plan the trip just now. Please try again in a moment.',
        'No he podido planificar el viaje ahora mismo. Vuelve a intentarlo en un momento.',
      );
  }
}

function planSentence(plan: PlanResponse, say: Words, lang: Lang): string {
  const best = plan.itineraries.find((itinerary) => itinerary.id === plan.recommendedId);
  const notices =
    plan.notices.length === 0
      ? ''
      : say(
          ` ${plan.notices.join(' ')}`,
          ` El plan trae avisos que de momento solo están en inglés: ${plan.notices.join(' ')}`,
        );
  if (best === undefined) {
    return say(
      `I could not find a way to get there in time.${notices}`,
      `No he encontrado cómo llegar a tiempo.${notices}`,
    );
  }
  const leave = time(new Date(best.departAt), lang);
  const arrive = time(new Date(best.arriveAt), lang);
  const spare = String(best.spareMinutes);
  return say(
    `Your trip is ready: leave at ${leave} to arrive at ${arrive}, with ${spare} minutes to spare.${notices}`,
    `Tu viaje está listo: sal a las ${leave} para llegar a las ${arrive}, con ${spare} minutos de margen.${notices}`,
  );
}

export function nextQuestion(state: ConversationState, say: Words): string {
  if (state.candidates !== null) {
    const options = state.candidates.places
      .map((place, index) => `${String(index + 1)}. ${place.label}`)
      .join('; ');
    return state.candidates.slot === 'origin'
      ? say(
          `Which of these is where you start? ${options}.`,
          `¿Desde cuál de estos sales? ${options}.`,
        )
      : say(`Which of these do you mean? ${options}.`, `¿Cuál de estos es? ${options}.`);
  }
  if (state.boardingPass !== null && state.pendingClock === null) {
    return boardingPassQuestion(state.boardingPass, say);
  }
  if (state.pendingClock !== null) {
    const { hour, minute } = state.pendingClock;
    const clock = `${String(hour)}:${String(minute).padStart(2, '0')}`;
    const evening = `${String(hour + 12)}:${String(minute).padStart(2, '0')}`;
    return say(
      `Is that ${clock} in the morning or ${clock} in the evening?`,
      `¿Son las ${clock} de la mañana o las ${evening} de la tarde?`,
    );
  }
  const draft = state.draft;
  const next = missingSlots(draft)[0];
  if (next === 'destination') {
    return say(
      'Where are you going, and when do you need to be there?',
      '¿A dónde vas y a qué hora tienes que llegar?',
    );
  }
  if (next === 'arriveBy') {
    const place = draft.destination?.label.split(',')[0] ?? '';
    return say(
      `What time do you need to be at ${place}?`,
      `¿A qué hora tienes que estar en ${place}?`,
    );
  }
  return say(
    'Where are you starting from? Type an address or a station.',
    '¿Desde dónde sales? Escribe una dirección o una estación.',
  );
}
