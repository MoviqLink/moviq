import { runsLine, type LiveSource, type LiveVehicle } from '@moviq/contracts';

import { useVirtualT } from '../../virtual/texts';
import { useLocale } from '../../../shared/i18n';
import { Icon } from '../../../shared/ui/Icon';
import { ageText, stopName } from '../model/card';
import { secondsSince } from '../model/vehicle';
import { useExploreT } from '../texts';
import type { ExploreDict } from '../texts-en';
import { AircraftBlock, ShipBlock, ShuttleBlock } from './CraftBlocks';
import { ServiceBlock } from './ServiceBlock';
import { SourceCredit } from './SourceCredit';
import { MovementBlock, SignalBlock } from './VehicleBlocks';

interface Props {
  readonly vehicle: LiveVehicle;
  readonly source: LiveSource | undefined;
  /** True when the vehicle left the latest data: the card shows the last of it, said so. */
  readonly lost: boolean;
  readonly now: number;
  readonly onClose: () => void;
  readonly onBoard?: (vehicleId: string) => void;
  readonly boarding?: boolean;
  readonly boardingFailed?: boolean;
}

/** A published position older than this is said to be as published, not estimated since. */
const AS_PUBLISHED_S = 60;

const formatSeconds = (instant: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(instant));

/** The origin of the position in one line: «Live GPS · data of 20:05:10». */
function originLine(vehicle: LiveVehicle, t: ExploreDict, locale: string, age: number): string {
  const { position, mode } = vehicle;
  const at = t.card.dataAt(formatSeconds(position.dataTime, locale));
  if (position.basis === 'gps-plus') {
    return `${t.card.origin['gps-plus']} · ${t.card.lastSignal(ageText(age))}`;
  }
  const origin =
    position.basis === 'gps' && (mode === 'aircraft' || mode === 'ship')
      ? t.craft.originOf[mode]
      : t.card.origin[position.basis];
  const published = position.basis !== 'predicted' && position.basis !== 'scheduled';
  return published && age > AS_PUBLISHED_S
    ? `${origin} · ${at} · ${t.craft.asPublished}`
    : `${origin} · ${at}`;
}

function destinationNote(vehicle: LiveVehicle, t: ExploreDict): string | null {
  const basis = vehicle.destination?.basis;
  if (basis === 'last-stop') return t.card.destinationLastStop;
  return basis === 'reported' ? t.card.destinationReported : null;
}

function CardHead({ vehicle, lost, age }: { vehicle: LiveVehicle; lost: boolean; age: number }) {
  const t = useExploreT();
  const locale = useLocale();
  const { position, line, destination } = vehicle;
  const kind = t.modeOne[vehicle.mode];
  const name = vehicle.name === null ? kind : `${kind} ${vehicle.name}`;
  const note = destinationNote(vehicle, t);
  const subtitle = vehicle.operator ?? line?.longName ?? null;
  return (
    <header className="ex-card-head">
      <div className="ex-card-id">
        {line !== null && <span className={`ex-line ${vehicle.mode}`}>{line.name}</span>}
        <h2>{name}</h2>
      </div>
      {(destination !== null || runsLine(vehicle.mode)) && (
        <p className="ex-to">
          {t.card.to} <b>{destination === null ? '—' : stopName(destination.name)}</b>
          {note !== null && <span className="ex-aside"> · {note}</span>}
        </p>
      )}
      {subtitle !== null && <p className="ex-longname">{subtitle}</p>}
      <p className={`ex-origin ${position.basis}`}>
        <i aria-hidden="true" />
        {originLine(vehicle, t, locale, age)}
      </p>
      {lost && <p className="ex-lost">{t.card.lost}</p>}
    </header>
  );
}

function positionKind(vehicle: LiveVehicle, t: ExploreDict): string {
  const { basis, station } = vehicle.position;
  if (station !== null) return t.card.stationKind;
  return basis === 'gps' ? t.card.gpsKind : t.card.origin[basis];
}

function CardFoot({ vehicle, source }: { vehicle: LiveVehicle; source: LiveSource | undefined }) {
  const t = useExploreT();
  const { lat, lon } = vehicle.position;
  return (
    <footer className="ex-foot">
      <span className="mono">
        {t.card.position(positionKind(vehicle, t), lat.toFixed(5), lon.toFixed(5))}
      </span>
      {source !== undefined && <SourceCredit source={source} />}
    </footer>
  );
}

/** What the vehicle does beyond its movement: its line and stops, or what the craft sends. */
function ModeBlock({ vehicle, now }: { vehicle: LiveVehicle; now: number }) {
  if (vehicle.mode === 'aircraft') return <AircraftBlock vehicle={vehicle} />;
  if (vehicle.mode === 'ship') return <ShipBlock vehicle={vehicle} />;
  if (vehicle.mode === 'shuttle') return <ShuttleBlock vehicle={vehicle} />;
  return <ServiceBlock vehicle={vehicle} now={now} />;
}

/**
 * The card of a vehicle, after Vektia's: who it is and where it goes, where its position comes
 * from and how old it is, its movement, its service or what its transponder sends and, at the
 * foot, its coordinates and source.
 */
export function VehicleCard({
  vehicle,
  source,
  lost,
  now,
  onClose,
  onBoard,
  boarding = false,
  boardingFailed = false,
}: Props) {
  const t = useExploreT();
  const virtual = useVirtualT();
  const age = secondsSince(vehicle.position.dataTime, now);
  return (
    <article
      className="ex-card ex-vehicle-card"
      aria-label={`${vehicle.line?.name ?? vehicle.name ?? ''} ${t.modeOne[vehicle.mode]}`}
    >
      <button type="button" className="ex-close" onClick={onClose} aria-label={t.card.close}>
        <Icon name="close" />
      </button>
      <CardHead vehicle={vehicle} lost={lost} age={age} />
      <SignalBlock vehicle={vehicle} age={age} />
      <MovementBlock vehicle={vehicle} />
      <ModeBlock vehicle={vehicle} now={now} />
      {vehicle.mode === 'bus' && onBoard !== undefined && !lost && (
        <button
          type="button"
          className="btn small"
          disabled={boarding}
          onClick={() => {
            onBoard(vehicle.id);
          }}
        >
          {boarding ? virtual.boarding : virtual.board}
        </button>
      )}
      {vehicle.mode === 'bus' && boardingFailed && <p role="alert">{virtual.failed}</p>}
      <CardFoot vehicle={vehicle} source={source} />
    </article>
  );
}
