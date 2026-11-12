/** Runs one read at a time, pausing requests while the page is hidden. */
export function startPolling(read: (signal: AbortSignal) => Promise<void>, interval: number) {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let restart = false;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const next = () => {
    clear();
    if (stopped || document.visibilityState === 'hidden') return;
    if (controller !== null) {
      restart = true;
      return;
    }
    const current = new AbortController();
    controller = current;
    const settled = () => {
      controller = null;
      if (stopped || document.visibilityState === 'hidden') return;
      const delay = restart ? 0 : interval;
      restart = false;
      timer = setTimeout(next, delay);
    };
    void read(current.signal).then(settled, settled);
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') {
      clear();
      restart = false;
      controller?.abort();
    } else next();
  };
  document.addEventListener('visibilitychange', visibility);
  next();
  return () => {
    stopped = true;
    clear();
    controller?.abort();
    document.removeEventListener('visibilitychange', visibility);
  };
}
