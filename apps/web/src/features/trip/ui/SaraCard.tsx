import type { Alternative, Journey, Payment } from '@moviq/contracts';
import { useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { ridesLine } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { ThinkingBar } from '../../../shared/ui/ThinkingBar';
import type { SaraWords } from '../model/sara';
import { PayWithPayPal } from '../payment/PayWithPayPal';
import { useTripT } from '../texts';
import { Alternatives } from './Alternatives';
import { AskSara } from './AskSara';
import { SaraSays } from './SaraSays';
import { UseRoute } from './UseRoute';

/** A change the person made on this screen: paid for an alternative or took a free one. */
export type Change =
  | { readonly kind: 'paid'; readonly payment: Payment; readonly sandbox: boolean }
  | { readonly kind: 'applied'; readonly alternativeId: string };

function changedAlternative(change: Change): string | null {
  if (change.kind === 'applied') return change.alternativeId;
  const purpose = change.payment.purpose;
  return purpose.kind === 'journey-alternative' ? purpose.alternativeId : null;
}

/** What changed, said once the option it came from has left the list. */
function Receipt({ change, journey }: { change: Change; journey: Journey }) {
  const t = useTripT();
  const j = useJourneyT();
  const locale = useLocale();
  if (change.kind === 'applied') {
    return <p className="pay-step captured">{t.use.done(ridesLine(journey.itinerary, j))}</p>;
  }
  const amount = formatMoney(change.payment.amount, locale);
  const paid = (change.sandbox ? t.pay.capturedSandbox : t.pay.captured)(amount);
  return <p className="pay-step captured">{`${paid} ${t.pay.applied}`}</p>;
}

interface Props {
  readonly journey: Journey;
  /** The alternatives in the order shown, recommended first. */
  readonly alternatives: readonly Alternative[];
  readonly selected: Alternative | null;
  /** Sara's words on the latest change, or the watch's own sentence and why. */
  readonly words: SaraWords;
  /** True while Sara reviews options that just arrived; they are shown once she is done. */
  readonly thinking: boolean;
  readonly change: Change | null;
  readonly onSelect: (id: string) => void;
  readonly onPaid: (payment: Payment, sandbox: boolean) => void;
  readonly onApplied: (journey: Journey, alternativeId: string) => void;
  readonly onGone: () => void;
  /** Sara passed a craving to the merchants on the way, with this need. */
  readonly onRewards: (needId: string) => void;
}

/**
 * Sara's card: her words on what changed, her options, PayPal or "Use this route", and a field
 * to ask her about the trip. An option she proposes is selected here, with its own button.
 */
export function SaraCard(props: Props) {
  const { journey, alternatives, selected, thinking, change } = props;
  const t = useTripT();
  // The option being paid for or taken; the choice is locked only while it is still on offer.
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const locked = busyWith !== null && alternatives.some((option) => option.id === busyWith);
  const risky = journey.watch.status === 'at-risk' || journey.watch.status === 'late';
  const showOptions = alternatives.length > 0 && !thinking;
  const settled =
    change !== null &&
    changedAlternative(change) !== null &&
    !alternatives.some((option) => option.id === changedAlternative(change));
  const busy = (id: string) => (on: boolean) => {
    setBusyWith(on ? id : null);
  };
  return (
    <section className="sara" aria-labelledby="sara-title">
      <h2 id="sara-title" className="sara-name">
        {t.sara.title}
      </h2>
      <div aria-live="polite">
        {settled && <Receipt change={change} journey={journey} />}
        {alternatives.length > 0 && thinking ? (
          <ThinkingBar label={t.sara.thinking} />
        ) : (
          <SaraSays words={props.words} risky={risky} />
        )}
      </div>
      {showOptions && (
        <Alternatives
          name={`alternatives-${journey.id}`}
          alternatives={alternatives}
          selected={selected?.id ?? null}
          onSelect={props.onSelect}
          locked={locked}
        />
      )}
      {showOptions && selected !== null && (
        <Choice {...props} selected={selected} onBusy={busy(selected.id)} />
      )}
      {journey.state === 'watching' && !locked && (
        <AskSara journeyId={journey.id} onProposal={props.onSelect} onRewards={props.onRewards} />
      )}
    </section>
  );
}

/** For the chosen option: PayPal when it costs money, "Use this route" when it is free. */
function Choice(props: Props & { selected: Alternative; onBusy: (on: boolean) => void }) {
  const { journey, selected, onBusy } = props;
  if (selected.price !== null) {
    return (
      <PayWithPayPal
        key={selected.id}
        journeyId={journey.id}
        alternativeId={selected.id}
        price={selected.price}
        onBusy={onBusy}
        onPaid={props.onPaid}
      />
    );
  }
  return (
    <UseRoute
      key={selected.id}
      journeyId={journey.id}
      alternativeId={selected.id}
      onBusy={onBusy}
      onApplied={(changed) => {
        props.onApplied(changed, selected.id);
      }}
      onGone={props.onGone}
    />
  );
}
