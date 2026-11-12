/** Refresh a selected route after each response; pause while the page is hidden. */
export function startRoutePolling(read: (signal: AbortSignal) => Promise<void>): () => void {
  let stopped = false;
  let active: AbortController | null = null;
  let timer: number | undefined;
  let refreshWhenDone = false;
  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const run = () => {
    clear();
    if (stopped || document.hidden) return;
    if (active !== null) {
      refreshWhenDone = true;
      return;
    }
    const controller = new AbortController();
    active = controller;
    const settled = () => {
      active = null;
      if (stopped || document.hidden) return;
      const delay = refreshWhenDone ? 0 : 30_000;
      refreshWhenDone = false;
      timer = window.setTimeout(run, delay);
    };
    void read(controller.signal).then(settled, settled);
  };
  const visibility = () => {
    if (document.hidden) {
      clear();
      refreshWhenDone = false;
      active?.abort();
    } else run();
  };
  document.addEventListener('visibilitychange', visibility);
  run();
  return () => {
    stopped = true;
    clear();
    active?.abort();
    document.removeEventListener('visibilitychange', visibility);
  };
}
