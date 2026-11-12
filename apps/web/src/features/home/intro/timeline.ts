/**
 * The beats of the intro in milliseconds, as Manu approved them (idea 53): the ring draws and the
 * name appears, the line is typed, the square cursor blinks three times (0.8 s each, as in
 * `intro.css`), the photo rises out of the dark, a short hold, and the intro fades away.
 */
export const INTRO_MS = {
  typeStart: 2100,
  typeTotal: 1300,
  blinks: 2400,
  reveal: 3000,
  hold: 900,
  leave: 450,
} as const;

export interface IntroTimeline {
  /** Time between two typed letters. */
  readonly step: number;
  /** When the last letter is typed and the cursor starts its three blinks. */
  readonly typed: number;
  /** When the photo starts to rise. */
  readonly reveal: number;
  /** When the intro starts to fade away. */
  readonly leave: number;
  /** When the page is left on its own. */
  readonly done: number;
}

/** The timeline for a line of `length` letters, typed at a steady 40 to 95 ms a letter. */
export function introTimeline(length: number): IntroTimeline {
  const letters = Math.max(1, length);
  const step = Math.max(40, Math.min(95, Math.round(INTRO_MS.typeTotal / letters)));
  const typed = INTRO_MS.typeStart + step * letters;
  const reveal = typed + INTRO_MS.blinks;
  const leave = reveal + INTRO_MS.reveal + INTRO_MS.hold;
  return { step, typed, reveal, leave, done: leave + INTRO_MS.leave };
}
