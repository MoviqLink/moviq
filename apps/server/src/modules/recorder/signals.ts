/** Reads the signal again after an await, which TypeScript's narrowing does not see. */
export function stopRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}
