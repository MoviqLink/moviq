import type { LiveSource } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { ageText } from '../model/card';
import { publishedDay, sourceAge } from '../model/source';
import { useExploreT } from '../texts';

/** The credit of a source with its addresses as links, as several licences ask. */
function Attribution({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/);
  return (
    <span className="ex-source-credit">
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/**
 * The source of what a card shows, at its foot: its title, its credit and how old its data is,
 * or, for a timetable, the day it was published and that it is in force.
 */
export function SourceCredit({ source }: { source: LiveSource }) {
  const t = useExploreT();
  const locale = useLocale();
  const age = sourceAge(source);
  return (
    <span title={source.provenance.evidence}>
      {t.card.source(source.title)} · <Attribution text={source.attribution} />
      {age !== null &&
        ` · ${
          age.kind === 'published'
            ? t.timetableInForce(publishedDay(age.at, locale))
            : t.sourceAge(ageText(age.seconds))
        }`}
    </span>
  );
}
