import { useLocale, useT } from '../../../shared/i18n';
import { formatDuration } from '../../../shared/time/duration';
import { formatClock, secondsSince, secondsUntil } from '../../../shared/time/instant';
import { useNow } from '../../../shared/time/clock';

/** An instant as "3 min 05 s ago" that keeps counting, with the local clock time beside it. */
export function Ago({ at, clock = true }: { at: string | null; clock?: boolean }) {
  const t = useT().time;
  const locale = useLocale();
  const now = useNow();
  if (at === null) return <span className="muted">{t.never}</span>;
  return (
    <time className="live" dateTime={at}>
      <span className="mono">{t.ago(formatDuration(secondsSince(at, now)))}</span>
      {clock && <span className="clock mono">{formatClock(at, locale, now)}</span>}
    </time>
  );
}

/** An instant still to come as "in 25 s", or "due now" once it has passed. */
export function Until({ at }: { at: string | null }) {
  const t = useT().time;
  const now = useNow();
  if (at === null) return <span className="muted">{t.none}</span>;
  const left = secondsUntil(at, now);
  return (
    <time className="mono" dateTime={at}>
      {left <= 0 ? t.due : t.in(formatDuration(left))}
    </time>
  );
}

/** An instant as the local clock time only. */
export function Clock({ at }: { at: string }) {
  const locale = useLocale();
  const now = useNow();
  return (
    <time className="mono" dateTime={at}>
      {formatClock(at, locale, now)}
    </time>
  );
}
