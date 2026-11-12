import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import type { SaraWords } from '../model/sara';
import { useSaraT } from '../sara-texts';
import { useTripT } from '../texts';
import './sara.css';

type Written = Extract<SaraWords, { kind: 'ai' }>;

/** The discreet line under Sara's words: the sources of her facts and when she wrote them. */
function Sources({ words }: { words: Written }) {
  const s = useSaraT();
  const locale = useLocale();
  const ids = words.sources.map((source) => source.sourceId);
  const detail = words.sources
    .map(({ sourceId, dataTime }) =>
      dataTime === null ? sourceId : `${sourceId} ${formatCityTime(dataTime, locale)}`,
    )
    .join(' · ');
  return (
    <p className="sara-sources" title={detail}>
      {s.sources(ids.join(', '))} ·{' '}
      <span className="sara-when">{s.writtenAt(formatCityTime(words.writtenAt, locale))}</span>
    </p>
  );
}

/**
 * What Sara says about the trip: her words on the latest change with their sources, or the
 * watch's own sentence and why, or that she is watching. Her words appear once, without motion
 * afterwards.
 */
export function SaraSays({ words, risky }: { words: SaraWords; risky: boolean }) {
  const t = useTripT();
  const s = useSaraT();
  const says = `sara-says${risky ? ' risk' : ''}`;
  switch (words.kind) {
    case 'quiet':
      return <p className="sara-quiet">{t.sara.watching}</p>;
    case 'writing':
      return <p className="sara-quiet">{s.writing}</p>;
    case 'ai':
      return (
        <div className="sara-words" key={words.writtenAt}>
          <p className={says}>{words.text}</p>
          <Sources words={words} />
        </div>
      );
    case 'basic':
      return (
        <div className="sara-words">
          <p className={says}>{words.evidence}</p>
          <p className="sara-sources">{s.basic[words.reason]}</p>
        </div>
      );
  }
}
