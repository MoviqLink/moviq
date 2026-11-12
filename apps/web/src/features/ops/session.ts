import type { OpsSession } from '@moviq/contracts';
import { createContext, useContext } from 'react';

export interface SessionValue {
  readonly session: OpsSession;
  /** Called when the API says the session is over: the screen goes back to the sign-in form. */
  readonly expire: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

/** The open session. Only screens rendered inside the signed-in console call this. */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession needs a signed-in console around it');
  return value;
}
