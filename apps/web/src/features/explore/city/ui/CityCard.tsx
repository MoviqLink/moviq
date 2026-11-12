import type { CityItem, LiveSource } from '@moviq/contracts';

import { useLocale } from '../../../../shared/i18n';
import { useAskSara } from '../../../../app/useAskSara';
import { Icon } from '../../../../shared/ui/Icon';
import { ageText } from '../../model/card';
import { publishedDay, sourceAge, type SourceAge } from '../../model/source';
import { useCityCardT } from '../texts';
import type { CardDict } from '../texts-card-en';
import { CameraBody } from './CameraBody';
import { dayText, Fact } from './Facts';
import {
  HarborReadingBody,
  NoticeBody,
  RoadConditionBody,
  VesselCallBody,
  WeatherAlertBody,
} from './HarborBodies';
import {
  PermittedEventBody,
  RoadEventBody,
  StreetClosureBody,
  TransitAlertBody,
} from './StreetBodies';
import { RestroomBody } from './RestroomBody';
import { ChargerBody, DefibrillatorBody, EntranceBody, MeterBody, SignBody } from './UsefulBodies';

interface Props {
  readonly item: CityItem;
  /** The source of the item with its credit and state; undefined when the answer lacks it. */
  readonly source: CitedSource | undefined;
  readonly now: number;
  readonly onClose: () => void;
}

function LandmarkBody({
  item,
}: {
  item: CityItem & { detail: Extract<CityItem['detail'], { kind: 'landmark' }> };
}) {
  const t = useCityCardT();
  const locale = useLocale();
  const ask = useAskSara();
  const { detail } = item;
  const message = locale.startsWith('es')
    ? `Quiero ir a ${item.title}${detail.address === null ? '' : `, ${detail.address}`}`
    : `I want to go to ${item.title}${detail.address === null ? '' : `, ${detail.address}`}`;
  return (
    <section className="ex-group">
      <Fact k={t.where} v={detail.address} />
      {detail.designatedOn !== null && (
        <Fact k={t.landmarkDate} v={dayText(detail.designatedOn, locale)} />
      )}
      <p className="ex-note">{t.landmarkNote}</p>
      <button
        type="button"
        className="ex-link"
        onClick={() => {
          ask(message);
        }}
      >
        {t.landmarkPlan}
      </button>
    </section>
  );
}

function Body({ item, now }: { item: CityItem; now: number }) {
  const { detail } = item;
  switch (detail.kind) {
    case 'road-event':
      return <RoadEventBody detail={detail} now={now} />;
    case 'street-closure':
      return <StreetClosureBody detail={detail} />;
    case 'permitted-event':
      return <PermittedEventBody detail={detail} now={now} />;
    case 'camera':
      return <CameraBody id={item.id} name={item.title} detail={detail} />;
    case 'charger':
      return <ChargerBody detail={detail} />;
    case 'defibrillator':
      return <DefibrillatorBody detail={detail} />;
    case 'restroom':
      return <RestroomBody detail={detail} />;
    case 'landmark':
      return <LandmarkBody item={{ ...item, detail }} />;
    case 'subway-entrance':
      return <EntranceBody detail={detail} />;
    case 'parking-meter':
      return <MeterBody detail={detail} />;
    case 'parking-sign':
      return <SignBody detail={detail} />;
    case 'vessel-call':
      return <VesselCallBody detail={detail} now={now} />;
    case 'harbor-reading':
      return <HarborReadingBody detail={detail} now={now} />;
    case 'notice':
      return <NoticeBody detail={detail} now={now} />;
    case 'transit-alert':
      return <TransitAlertBody detail={detail} now={now} />;
    case 'road-condition':
      return <RoadConditionBody detail={detail} now={now} />;
    case 'weather-alert':
      return <WeatherAlertBody detail={detail} now={now} />;
  }
}

interface CitedSource {
  readonly title: string;
  readonly attribution: string;
  readonly age: SourceAge | null;
}

/** How old a listing is: read so long ago, or in force since the day its file was published. */
const ageWords = (age: SourceAge, t: CardDict, locale: string): string =>
  age.kind === 'published'
    ? t.inForce(publishedDay(age.at, locale))
    : t.listedAge(ageText(age.seconds));

/** The source of a city item with its credit, as Explore cites every source. */
export function sourceOf(
  sources: readonly LiveSource[],
  sourceId: string,
): CitedSource | undefined {
  const source = sources.find((candidate) => candidate.provenance.sourceId === sourceId);
  return source === undefined
    ? undefined
    : {
        title: source.title,
        attribution: source.attribution,
        age: sourceAge(source),
      };
}

/** The card of one thing of a city layer: what it is, its facts and its source with its credit. */
export function CityCard({ item, source, now, onClose }: Props) {
  const t = useCityCardT();
  const locale = useLocale();
  return (
    <article className="ex-card ex-city-card" aria-label={item.title}>
      <header className="ex-card-head">
        <div className="ex-card-id">
          <h2>{item.title}</h2>
          <button type="button" className="ex-close" onClick={onClose} aria-label={t.close}>
            <Icon name="close" />
          </button>
        </div>
        <p className="ex-longname">{t.kinds[item.layer]}</p>
      </header>
      <Body item={item} now={now} />
      {source !== undefined && (
        <footer className="ex-foot">
          <span>
            {t.source(source.title)} · {source.attribution}
            {source.age === null ? '' : ` · ${ageWords(source.age, t, locale)}`}
          </span>
        </footer>
      )}
    </article>
  );
}
