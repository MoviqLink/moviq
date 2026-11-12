import type { CityDetail } from '@moviq/contracts';

import { Icon } from '../../../../shared/ui/Icon';
import { useCityCardT } from '../texts';
import { Fact, Group } from './Facts';

type Restroom = Extract<CityDetail, { kind: 'restroom' }>;

/**
 * A public restroom of the city's list: free and in service, its hours line by line as published
 * and never read as "open now", with a key or code said plainly and the city's own page.
 */
export function RestroomBody({ detail }: { detail: Restroom }) {
  const t = useCityCardT().restroom;
  const place = detail.placeType === null ? null : (t.places[detail.placeType] ?? detail.placeType);
  return (
    <>
      <section className="ex-group">
        <p className="ex-v">{t.free}</p>
        {place !== null && <span className="ex-note">{place}</span>}
        <Fact k={t.operator} v={detail.operator} />
      </section>
      <Group title={t.hours}>
        <p className="ex-city-text mono">{detail.hours ?? t.noHours}</p>
        {detail.season !== null && <span className="ex-note">{t.season[detail.season]}</span>}
        <span className="ex-note">{t.never}</span>
      </Group>
      <section className="ex-group">
        <Fact k={t.access} v={detail.access === null ? null : t.levels[detail.access]} />
        <Fact k={t.stalls} v={detail.stalls === null ? null : t.stallKinds[detail.stalls]} />
        <Fact
          k={t.changing}
          v={detail.changingTable === null ? null : t.changingKinds[detail.changingTable]}
        />
        {detail.keyOrCode && <p className="ex-state ex-risk">{t.key}</p>}
        <Fact k={t.note} v={detail.note} />
        {detail.website !== null && (
          <a
            className="ex-ev-official"
            href={detail.website}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.official}
            <Icon name="external" />
          </a>
        )}
      </section>
    </>
  );
}
