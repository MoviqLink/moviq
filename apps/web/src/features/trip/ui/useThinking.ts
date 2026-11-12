import { useEffect, useState } from 'react';

/** How long Sara's thinking bar takes to fill, once. */
const THINKING_MS = 4_000;

/**
 * True while Sara "thinks" about a set of options that arrived live. The set present when the
 * screen opened is shown at once; each new one waits for the bar to fill a single time.
 */
export function useThinking(key: string): boolean {
  const [shown, setShown] = useState(key);
  useEffect(() => {
    if (key === shown) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => {
        setShown(key);
      },
      reduce ? 0 : THINKING_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, shown]);
  return key !== shown && key !== '';
}
