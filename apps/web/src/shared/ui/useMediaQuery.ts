import { useCallback, useSyncExternalStore } from 'react';

/** Whether a CSS media query matches now; the component re-renders when that changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => {
        list.removeEventListener('change', listener);
      };
    },
    [query],
  );
  const snapshot = () => window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
