import type { CityAnswer } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { CityTime } from '../../../shared/journey/CityTime';
import { sourceNotes } from '../model/city';
import { usePlanT } from '../texts';

/**
 * What Sara found about the city, under her words: the subject and its verdict, the details on
 * the route line with their times, and the sources with the time of their data.
 */
export function CityAnswers({ answers }: { answers: readonly CityAnswer[] }) {
  if (answers.length === 0) return null;
  return (
    <div className="city-answers">
      {answers.map((answer, index) => (
        <CityCard key={`${answer.kind}-${answer.subject}-${String(index)}`} answer={answer} />
      ))}
    </div>
  );
}

/** A line as Sara names it (`A`, `M15-SBS`, `HOB-WTC`): set as a mark, not as a name. */
const LINE = /^[A-Z0-9+-]{1,7}$/i;

function CityCard({ answer }: { answer: CityAnswer }) {
  const t = usePlanT().city;
  const locale = useLocale();
  const notes = sourceNotes(answer.sources, t, locale);
  return (
    <section className={`city-answer is-${answer.level}`} aria-label={t.label(answer.subject)}>
      <header className="ca-head">
        <span className={LINE.test(answer.subject) ? 'ca-subject line' : 'ca-subject'}>
          {answer.subject}
        </span>
        <span className="ca-level">{t.levels[answer.level]}</span>
      </header>
      <p className="ca-headline">{answer.headline}</p>
      {answer.items.length > 0 && (
        <ol className="ca-items">
          {answer.items.map((item) => (
            <li key={item.text}>
              <span className="ca-text">{item.text}</span>
              {item.at !== null && <CityTime at={item.at} className="ca-at" />}
            </li>
          ))}
        </ol>
      )}
      <p className="ca-sources">
        <span className="ca-sources-label">{notes.length === 1 ? t.source : t.sources}</span>
        {notes.map((note) => (
          <span
            key={note.sourceId}
            className={note.usable ? 'ca-source' : 'ca-source down'}
            title={`${note.title} · ${note.sourceId}`}
          >
            {note.title} · {note.when}
          </span>
        ))}
      </p>
    </section>
  );
}
