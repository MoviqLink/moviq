import type { Lang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { SAMPLE_NOTICE, type SampleLeg } from './sample';

/** A sample amount in cents, written in the reader's language. */
export const fare = (amountMinor: number, locale: string): string =>
  formatMoney({ amountMinor, currency: 'USD' }, locale);

/** The departure time of a trip in the reader's language: `8:12 AM` or `8:12`. */
export const clock = (at: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);

/** One line as a round badge with its name; a bus route is a pill, as it is longer. */
function LineBadge({ leg }: { leg: SampleLeg }) {
  return <span className={`triplog-line is-${leg.mode}`}>{leg.line}</span>;
}

export function LineBadges({ legs }: { legs: readonly SampleLeg[] }) {
  return (
    <span className="triplog-lines">
      {legs.map((leg, index) => (
        <LineBadge key={`${leg.line}-${String(index)}`} leg={leg} />
      ))}
    </span>
  );
}

/** Every block that shows the sample trips says plainly that they were not travelled. */
export function SampleNotice({ lang }: { lang: Lang }) {
  return (
    <p className="triplog-notice" role="note">
      {SAMPLE_NOTICE[lang]}
    </p>
  );
}

interface HeadProps {
  readonly kicker: string;
  readonly title: string;
  readonly lead: string;
}

export function ScreenHead({ kicker, title, lead }: HeadProps) {
  return (
    <header className="triplog-head">
      <p className="triplog-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p className="triplog-lead">{lead}</p>
    </header>
  );
}
