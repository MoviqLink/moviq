import { createContext, useContext } from 'react';

import type { DemoMerchant } from './schemas';

export interface MerchantSession {
  readonly merchant: DemoMerchant;
  /** Called when the API says the session is over: the panel goes back to choosing a merchant. */
  readonly expire: () => void;
}

export const MerchantSessionContext = createContext<MerchantSession | null>(null);

/** The open demo session. Only screens inside the signed-in panel call this. */
export function useMerchantSession(): MerchantSession {
  const value = useContext(MerchantSessionContext);
  if (value === null) throw new Error('useMerchantSession needs the signed-in panel around it');
  return value;
}
