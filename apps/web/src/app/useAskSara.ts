import { useCallback } from 'react';

import { travellerHref } from '../shared/routing/hrefs';
import { setPendingAsk } from '../shared/routing/pending-ask';

/**
 * Words for Sara written on another screen: they go to the Agent screen, where the one
 * conversation with her lives, and are sent there.
 */
export function useAskSara(): (message: string) => void {
  return useCallback((message: string) => {
    setPendingAsk(message);
    window.location.hash = travellerHref.agents;
  }, []);
}
