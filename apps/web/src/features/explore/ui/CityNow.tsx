import { useLang } from '../../../shared/i18n/lang';
import type { useLineCatalog } from '../live/useLineCatalog';
import { ageText } from '../model/card';
import { cityNow } from '../model/city-now';
import { useExploreT } from '../texts';
import { WORDS } from './your-map-words';

/** The city now: one card per mode with what is followed, its state and the age of its data. */
export function CityNow({
  catalog,
  now,
}: {
  catalog: ReturnType<typeof useLineCatalog>;
  now: number;
}) {
  const w = WORDS[useLang()];
  const t = useExploreT();
  if (catalog.data === null) return null;
  return (
    <section aria-labelledby="city-now-title">
      <h2 id="city-now-title" className="ex-eyebrow">
        {w.cityNow}
      </h2>
      <ul className="city-now">
        {cityNow(catalog.data, now).map((card) => (
          <li key={card.mode} className="city-now-card" data-mode={card.mode}>
            <span className="city-now-mode">{t.modes[card.mode]}</span>
            <strong>{card.status === 'not-connected' ? '—' : String(card.shown)}</strong>
            <span className="ex-note">
              {w.status[card.status]}
              {card.ageSeconds === null ? '' : ` · ${t.sourceAge(ageText(card.ageSeconds))}`}
            </span>
            <span className="ex-note">{card.onMap ? w.onMapNow : w.byRoute}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
