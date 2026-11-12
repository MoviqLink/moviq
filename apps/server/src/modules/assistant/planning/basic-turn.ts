import { askCity } from '../city/ask.js';
import { readCityQuestion } from '../understanding/city-question.js';
import { airportIn, readSentence, type Reading } from '../understanding/reader.js';
import { arrivalFrom } from '../understanding/time-words.js';
import {
  airportQuery,
  choosePlace,
  findPlace,
  setArrival,
  settlePlan,
  type PlanningPorts,
} from './actions.js';
import { fillBoardingPass, findFlight } from './flight-actions.js';
import type { PlaceSlot, Turn } from './state.js';

/**
 * The basic assistant: the deterministic reader fills the same slots with the same actions as
 * the model would. It understands simple sentences and short answers to the last question, and
 * the usual questions about lines, incidents, vehicles and stations, which leave the trip as it is.
 */
export async function basicTurn(ports: PlanningPorts, turn: Turn, message: string): Promise<void> {
  const question = readCityQuestion(message, turn.now);
  if (question !== undefined) {
    // A turn that fell back to basic mode may already hold what the model asked for.
    if (turn.city.length === 0) await askCity(ports, turn, question);
    return;
  }
  const reading = readSentence(message, turn.now);
  const { state } = turn;
  const answered = await answerPending(ports, turn, reading);
  if (reading.flight !== undefined) {
    await findFlight(ports, turn, {
      ...reading.flight,
      date: reading.day ?? null,
      airport: reading.airport,
    });
  }
  // A flight AeroDataBox could not give: this sentence reads its boarding pass.
  const boardingPass =
    !answered &&
    reading.flight === undefined &&
    state.boardingPass !== null &&
    (reading.clock !== undefined ||
      reading.airport !== undefined ||
      reading.terminal !== undefined);
  if (boardingPass) {
    await fillBoardingPass(ports, turn, {
      clock: reading.clock,
      day: reading.day ?? null,
      airport: reading.airport,
      terminal: reading.terminal,
    });
  }
  const plainSlot = answered || boardingPass ? undefined : slotForPlainWords(turn);
  const destination = boardingPass
    ? undefined
    : (reading.destination ?? (plainSlot === 'destination' ? reading.plain : undefined));
  if (reading.flight === undefined && destination !== undefined) {
    const airport = airportIn(destination);
    await findPlace(ports, turn, 'destination', airport ? airportQuery(airport) : destination);
  }
  const arrival = reading.clock !== undefined && !boardingPass && reading.flight === undefined;
  if (arrival && state.draft.flight === null && state.boardingPass === null) {
    const day = reading.day ?? state.pendingClock?.day ?? null;
    setArrival(turn, arrivalFrom(reading.clock, day, turn.now));
  }
  const origin = reading.origin ?? (plainSlot === 'origin' ? reading.plain : undefined);
  const flightAirport =
    origin !== undefined &&
    airportIn(origin) !== undefined &&
    (state.draft.flight !== null || boardingPass);
  if (origin !== undefined && !flightAirport) await findPlace(ports, turn, 'origin', origin);
  await settlePlan(ports, turn);
}

/** A choice among the places offered, or "morning"/"evening" for an hour said alone. */
async function answerPending(ports: PlanningPorts, turn: Turn, reading: Reading): Promise<boolean> {
  const { state } = turn;
  if (state.candidates !== null && reading.choice !== undefined) {
    choosePlace(turn, state.candidates.slot, reading.choice);
    return true;
  }
  const pending = state.pendingClock;
  if (pending !== null && reading.half !== undefined && reading.clock === undefined) {
    const clock = { ...pending, half: reading.half };
    if (state.boardingPass === null) {
      setArrival(turn, arrivalFrom(clock, pending.day, turn.now));
    } else {
      await fillBoardingPass(ports, turn, {
        clock,
        day: pending.day,
        airport: reading.airport,
        terminal: reading.terminal,
      });
    }
    return true;
  }
  return false;
}

/** Words with no marker answer the open question, or name the destination first. */
function slotForPlainWords(turn: Turn): PlaceSlot | undefined {
  const { state } = turn;
  if (state.candidates !== null) return state.candidates.slot;
  if (state.asked === 'origin' || state.asked === 'destination') return state.asked;
  if (state.asked === 'arriveBy') return undefined;
  if (state.draft.destination === null && state.draft.flight === null) return 'destination';
  return state.draft.origin === null ? 'origin' : undefined;
}
