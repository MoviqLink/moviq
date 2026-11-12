import type { LiveVehicle } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import {
  ageText,
  compassPoint,
  courseText,
  formatMargin,
  roundSpeed,
  signalBars,
  wholeDegrees,
} from '../model/card';
import { useExploreT } from '../texts';
import type { ExploreDict } from '../texts-en';
import { Compass, MarginIcon, SignalBars } from './Gauges';

function noSpeedNote(vehicle: LiveVehicle, t: ExploreDict): string {
  if (vehicle.position.station !== null) return t.card.noSpeedStation;
  if (vehicle.mode === 'shuttle') return t.craft.shuttle.noSpeed;
  return t.card.noSpeedYet;
}

function SpeedBlock({ vehicle, t }: { vehicle: LiveVehicle; t: ExploreDict }) {
  const { speed } = vehicle;
  if (speed === null) {
    return (
      <div className="ex-speed">
        <span className="ex-k">{t.card.speed}</span>
        <span className="ex-v ex-none">—</span>
        <span className="ex-note">{noSpeedNote(vehicle, t)}</span>
      </div>
    );
  }
  const rounded = roundSpeed(speed.kmh);
  const note =
    speed.basis === 'computed' && speed.overSeconds !== null
      ? t.card.computedSpeed(Math.round(speed.overSeconds))
      : t.card.reportedSpeed;
  return (
    <div className="ex-speed">
      <span className="ex-k">{t.card.speed}</span>
      {rounded === null ? (
        <span className="ex-v ex-word">{t.card.stopped}</span>
      ) : (
        <span className="ex-v">
          <span className="ex-number">{rounded}</span>
          <small>{t.card.kmh}</small>
        </span>
      )}
      <span className="ex-note">{note}</span>
    </div>
  );
}

function CourseBlock({ vehicle, t }: { vehicle: LiveVehicle; t: ExploreDict }) {
  const { bearing } = vehicle;
  const courseNote =
    vehicle.mode === 'subway' || vehicle.position.station !== null
      ? t.card.computedCourse
      : t.card.computedCourseGps;
  return (
    <div className="ex-course">
      <Compass degrees={bearing === null ? null : wholeDegrees(bearing.degrees)} />
      <div>
        <span className="ex-k">{t.card.course}</span>
        {bearing === null ? (
          <span className="ex-v ex-none">—</span>
        ) : (
          <>
            <span className="ex-v mono">{courseText(bearing.degrees)}</span>
            <span className="ex-note">
              {t.points[compassPoint(bearing.degrees)]}
              {bearing.basis === 'computed' ? ` · ${courseNote}` : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** How old the last signal is, as bars and seconds, and the measured margin of the position. */
export function SignalBlock({ vehicle, age }: { vehicle: LiveVehicle; age: number }) {
  const t = useExploreT();
  const locale = useLocale();
  const { marginMeters, basis } = vehicle.position;
  return (
    <section className="ex-group" aria-label={t.card.signal}>
      <span className="ex-k">{t.card.signal}</span>
      <div className="ex-pair">
        <div className="ex-indicator">
          <SignalBars ageSeconds={age} label={t.card.bars(signalBars(age))} />
          <div>
            <span className="ex-k">
              {basis === 'gps' || basis === 'gps-plus' ? t.card.lastGps : t.card.lastData}
            </span>
            <span className="ex-v mono">{ageText(age)}</span>
          </div>
        </div>
        <div className="ex-indicator">
          <MarginIcon />
          <div>
            <span className="ex-k">{t.card.margin}</span>
            {marginMeters === null ? (
              <>
                <span className="ex-v ex-none">—</span>
                <span className="ex-note">{t.card.notMeasured}</span>
              </>
            ) : (
              <span className="ex-v mono">{formatMargin(marginMeters, locale)}</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Speed and course, each with where it comes from. */
export function MovementBlock({ vehicle }: { vehicle: LiveVehicle }) {
  const t = useExploreT();
  return (
    <section className="ex-group" aria-label={t.card.movement}>
      <span className="ex-k">{t.card.movement}</span>
      <div className="ex-movement">
        <SpeedBlock vehicle={vehicle} t={t} />
        <CourseBlock vehicle={vehicle} t={t} />
      </div>
    </section>
  );
}
