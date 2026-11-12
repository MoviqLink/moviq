/**
 * Seconds as the two largest units, written the same in English and Spanish: `45 s`,
 * `3 min 05 s`, `2 h 10 min`, `3 d 4 h`.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${String(s)} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${String(minutes)} min ${String(s % 60).padStart(2, '0')} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `${String(Math.floor(hours / 24))} d ${String(hours % 24)} h`;
}

/** A limit in its natural unit, without padding: `90 s`, `2 min`, `1 h`, `36 h`. */
export function formatLimit(seconds: number): string {
  if (seconds < 120) return `${String(Math.round(seconds))} s`;
  if (seconds < 7200) return `${String(Math.round(seconds / 60))} min`;
  return `${String(Math.round(seconds / 3600))} h`;
}

/** Milliseconds for latencies: `840 ms`, `1.2 s`. */
export function formatMs(ms: number, locale: string): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  return `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`;
}
