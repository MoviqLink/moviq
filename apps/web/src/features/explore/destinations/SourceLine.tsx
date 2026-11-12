import type { LiveSource } from '@moviq/contracts';
import { useLocale } from '../../../shared/i18n';
import { useDestinationT } from './texts';

export function SourceLine({ source }: { source: LiveSource | undefined }) {
  const t = useDestinationT();
  const locale = useLocale();
  if (source === undefined) return <p className="destination-source">{t.unknown}</p>;
  const at = source.provenance.dataTime;
  const time =
    at === null
      ? ''
      : new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        }).format(new Date(at));
  return (
    <p className="destination-source" title={source.provenance.evidence}>
      {source.title} · {t.states[source.provenance.state]}
      {time === '' ? '' : ` · ${time} ET`}
    </p>
  );
}
