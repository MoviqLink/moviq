import type { LiveLine, LiveLineKey, LiveMode } from '@moviq/contracts';
import { useCallback, useMemo, useState } from 'react';
import { lineKey } from '../model/line-selection';

export function useLineSelection() {
  const [lines, setLines] = useState<readonly LiveLine[]>([]);
  const [others, setOthers] = useState<ReadonlySet<LiveMode>>(() => new Set());
  const add = useCallback((line: LiveLine) => {
    setLines((current) =>
      current.some((item) => lineKey(item) === lineKey(line)) ? current : [...current, line],
    );
  }, []);
  const remove = useCallback((line: LiveLineKey) => {
    setLines((current) => current.filter((item) => lineKey(item) !== lineKey(line)));
  }, []);
  const toggleOther = useCallback((mode: LiveMode) => {
    setOthers((current) => {
      const next = new Set(current);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }, []);
  return useMemo(
    () => ({ lines, others, add, remove, toggleOther }),
    [lines, others, add, remove, toggleOther],
  );
}
