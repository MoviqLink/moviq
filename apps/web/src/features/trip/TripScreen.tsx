import type { Journey } from '@moviq/contracts';
import { useState } from 'react';

import { LegRail } from '../../shared/journey/LegRail';
import { orderAlternatives } from '../../shared/journey/order';
import { useDarkTheme } from '../../shared/theme/useDarkTheme';
import { TopBar } from '../../shared/ui/TopBar';
import { useMediaQuery } from '../../shared/ui/useMediaQuery';
import { RewardsOnTheWay } from '../rewards/RewardsOnTheWay';
import { useJourney, type JourneyView } from './live/useJourney';
import { useSaraWords } from './live/useSaraWords';
import { TripMap } from './map/TripMap';
import { project, riskyLegs } from './model/projection';
import { useTripT } from './texts';
import { FlightPanel } from './ui/FlightPanel';
import { Incidents } from './ui/Incidents';
import { LiveLine } from './ui/LiveLine';
import { RestroomsOnTheWay } from './ui/RestroomsOnTheWay';
import { SaraCard, type Change } from './ui/SaraCard';
import { Sheet } from './ui/Sheet';
import { StepFree } from './ui/StepFree';
import { Timeline } from './ui/Timeline';
import { TripNotice } from './ui/TripNotice';
import { useThinking } from './ui/useThinking';
import { WatchSummary } from './ui/WatchSummary';
import './trip.css';

function Panel({ journey, view }: { journey: Journey; view: JourneyView }) {
  const { itinerary, incidents } = journey;
  return (
    <div className="trip-panel-in">
      <WatchSummary journey={journey} />
      <LiveLine view={view} />
      <FlightPanel journey={journey} />
      <LegRail
        legs={itinerary.legs}
        arriveAt={project(journey).arriveAt}
        risky={riskyLegs(incidents)}
      />
      <StepFree journey={journey} />
      <Incidents journey={journey} />
    </div>
  );
}

/** The trip with its map: the panel with the steps, Sara's options and the timeline. */
function TripView({ journey, view }: { journey: Journey; view: JourneyView }) {
  const t = useTripT();
  const wide = useMediaQuery('(min-width: 1024px)');
  const dark = useDarkTheme();
  const alternatives = orderAlternatives(journey.alternatives);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected =
    alternatives.find((alternative) => alternative.id === chosen) ?? alternatives[0] ?? null;
  const thinking = useThinking(alternatives.map((alternative) => alternative.id).join('|'));
  const [change, setChange] = useState<Change | null>(null);
  const words = useSaraWords(journey, view.replace);
  // The need Sara opened from her field, whose questions and offers show under her card.
  const [fromSara, setFromSara] = useState<string | null>(null);
  const watching = journey.state === 'watching';
  const rewards = watching && <RewardsOnTheWay journeyId={journey.id} fromSara={fromSara} />;
  const restrooms = watching && <RestroomsOnTheWay journey={journey} />;
  const sara = (
    <SaraCard
      journey={journey}
      alternatives={alternatives}
      selected={selected}
      words={words}
      thinking={thinking}
      change={change}
      onSelect={setChosen}
      onPaid={(payment, sandbox) => {
        setChange({ kind: 'paid', payment, sandbox });
        view.reconnect();
      }}
      onApplied={(changed, alternativeId) => {
        setChange({ kind: 'applied', alternativeId });
        view.replace(changed);
      }}
      onGone={view.reconnect}
      onRewards={setFromSara}
    />
  );
  return (
    <>
      <TripMap
        journey={journey}
        alternative={thinking ? null : selected}
        dark={dark}
        wide={wide}
        label={t.map(journey.request.destination.label)}
        failedText={t.mapFailed}
      />
      {wide ? (
        <>
          <aside className="trip-panel">
            <Panel journey={journey} view={view} />
          </aside>
          <aside className="trip-side">
            {sara}
            {restrooms}
            {rewards}
          </aside>
          <div className="trip-bottom">
            <Timeline journey={journey} />
          </div>
        </>
      ) : (
        <Sheet>
          <Panel journey={journey} view={view} />
          {sara}
          {restrooms}
          {rewards}
          <Timeline journey={journey} />
        </Sheet>
      )}
    </>
  );
}

/** The trip `id`. Rendered with `key={id}`, so nothing of another trip survives a new address. */
export function TripScreen({ id }: { id: string }) {
  const t = useTripT();
  const view = useJourney(id);
  return (
    <>
      <TopBar variant="floating" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" className="trip" tabIndex={-1}>
        {view.journey === null ? (
          <TripNotice view={view} />
        ) : (
          <TripView journey={view.journey} view={view} />
        )}
      </main>
    </>
  );
}
