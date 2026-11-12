import type { Journey, Leg } from '@moviq/contracts';

import { useLocale, useT } from '../../../shared/i18n';
import { useNow } from '../../../shared/time/clock';
import { formatCityTime } from '../../../shared/time/city';
import { formatDuration } from '../../../shared/time/duration';
import { secondsSince } from '../../../shared/time/instant';
import {
  isOpen,
  stepFreeLead,
  type Accessibility,
  type AccessWarning,
  type PlatformAccess,
  type StepFreeLead,
} from '../model/step-free';
import { useStepFreeT, type StepFreeDict } from '../step-free-texts';
import './step-free.css';

function leadText(lead: StepFreeLead, t: StepFreeDict, time: (at: string) => string): string {
  switch (lead.kind) {
    case 'clear':
      return t.lead.clear(time(lead.checkedAt));
    case 'elevator-out':
      return t.lead['elevator-out'](lead.station, lead.elevator);
    case 'not-step-free':
      return t.lead['not-step-free'](lead.station);
    case 'unconfirmed':
      return t.lead.unconfirmed(lead.station);
    case 'walk-unchecked':
      return t.lead['walk-unchecked'](lead.step);
    case 'unchecked':
      return t.lead.unchecked;
    case 'not-checked':
      return t.lead['not-checked'];
  }
}

function warningText(warning: AccessWarning, t: StepFreeDict): string {
  switch (warning.kind) {
    case 'change-unverified':
      return t.change(warning.from, warning.to);
    case 'modes-left-out':
      return t.modesLeftOut(warning.modes);
    case 'entrance-not-surveyed':
      return t.entrance(warning.station);
    case 'walk-unverified':
      return t.walk(warning.legIndex + 1);
  }
}

/** What the MTA says of the elevators behind a platform, or why it cannot be confirmed. */
function Detail({ platform }: { platform: PlatformAccess }) {
  const t = useStepFreeT();
  const locale = useLocale();
  const time = (at: string) => formatCityTime(at, locale);
  if (platform.state === 'elevator-out') {
    return (
      <ul className="sf-detail">
        {platform.elevators.map((elevator) => (
          <li key={elevator.id}>
            {t.elevator(elevator.id, elevator.serving)}
            {elevator.since === null
              ? ''
              : ` · ${(elevator.upcoming ? t.announced : t.outSince)(time(elevator.since))}`}
            {elevator.estimatedReturn === null
              ? ''
              : ` · ${t.back(time(elevator.estimatedReturn))}`}
          </li>
        ))}
      </ul>
    );
  }
  // Lists that cannot be read are said once, in the lead, not on every platform.
  if (platform.cause === null || platform.cause === 'lists-unavailable') return null;
  const codes = platform.elevators.map((elevator) => elevator.id).join(', ');
  return (
    <p className="sf-detail">
      {t.causes[platform.cause]}
      {codes === '' ? '' : ` (${codes})`}
    </p>
  );
}

function Platform({ platform, leg }: { platform: PlatformAccess; leg: Leg | undefined }) {
  const t = useStepFreeT();
  const line = leg?.route?.shortName ?? '';
  const role = platform.at === 'board' ? t.board(line) : t.alight(line);
  return (
    <li className={`sf-stop ${isOpen(platform) ? 'open' : platform.state}`}>
      <div className="sf-row">
        <b>{platform.station}</b>
        <span className="sf-state">{t.states[platform.state]}</span>
      </div>
      <p className="sf-role">{role}</p>
      <Detail platform={platform} />
    </li>
  );
}

/** When the outages were read and from where; the provenance's evidence on hover. */
function Proof({ access }: { access: Accessibility }) {
  const t = useStepFreeT();
  const states = useT().states;
  const now = useNow();
  const { provenance } = access;
  const state = states[provenance.state].label.toLowerCase();
  const text =
    provenance.dataTime === null
      ? t.sourceNoAge(state)
      : t.source(state, formatDuration(secondsSince(provenance.dataTime, now)));
  return (
    <p className="sf-proof" title={`${provenance.sourceId}: ${provenance.evidence}`}>
      {text}
    </p>
  );
}

/**
 * A step-free trip as the MTA lists and the watch see it: one sentence, each platform where a
 * ride is boarded or left, what is not verified, and why no step-free alternative could be
 * looked for. Nothing for a trip that is not step-free.
 */
export function StepFree({ journey }: { journey: Journey }) {
  const t = useStepFreeT();
  const locale = useLocale();
  if (!journey.request.preferences.stepFree) return null;
  const access = journey.itinerary.accessibility ?? null;
  const lead = stepFreeLead(access);
  const refusal = journey.watch.stepFreeRefusal;
  const time = (at: string) => formatCityTime(at, locale);
  return (
    <section className={`step-free ${lead.kind}`} aria-labelledby="step-free-title">
      <h2 id="step-free-title">{t.title}</h2>
      {/* A refusal says more than lists that cannot be read: then it stands alone. */}
      {(refusal === null || lead.kind !== 'unchecked') && (
        <p className="sf-lead">{leadText(lead, t, time)}</p>
      )}
      {refusal !== null && (
        <p className="sf-refused" title={refusal.detail}>
          {t.refused(t.reasons[refusal.reason])}
        </p>
      )}
      {access !== null && access.platforms.length > 0 && (
        <ol className="sf-stops">
          {access.platforms.map((platform) => (
            <Platform
              key={`${String(platform.legIndex)}-${platform.at}`}
              platform={platform}
              leg={journey.itinerary.legs[platform.legIndex]}
            />
          ))}
        </ol>
      )}
      {access !== null && access.warnings.length > 0 && (
        <ul className="sf-warnings">
          {access.warnings.map((warning) => (
            <li key={`${warning.kind}-${'legIndex' in warning ? String(warning.legIndex) : ''}`}>
              {warningText(warning, t)}
            </li>
          ))}
        </ul>
      )}
      {access !== null && <Proof access={access} />}
    </section>
  );
}
