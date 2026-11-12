import { useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { merchantApi } from '../api';
import { collected, lineText, refundSaid } from '../model/counter';
import type { KitchenTicket, RefundAnswer } from '../schemas';
import { useMerchantT } from '../texts';
import { useAction } from '../useAction';
import { ProblemNote } from './ProblemNote';

/** The lines of one collected order, to mark the ones that were missing. */
function Lines(props: {
  ticket: KitchenTicket;
  chosen: ReadonlySet<number>;
  missing: boolean;
  onToggle: (index: number) => void;
}) {
  const t = useMerchantT().refund;
  return (
    <fieldset className="mc-checks">
      <legend>{t.lines}</legend>
      {props.ticket.lines.map((line, index) => (
        <label key={`${props.ticket.orderId}-${String(index)}`}>
          <input
            type="checkbox"
            checked={props.chosen.has(index)}
            onChange={() => {
              props.onToggle(index);
            }}
          />
          {lineText(line)}
        </label>
      ))}
      {props.missing && <p className="error">{t.pickOne}</p>}
    </fieldset>
  );
}

/** What the last refund did: refunded, in progress (never said as refunded) and PayPal's word. */
function RefundSaid({ answer }: { answer: RefundAnswer | null }) {
  const t = useMerchantT().refund;
  const locale = useLocale();
  return (
    <div className="mc-said" role="status">
      {answer !== null && (
        <>
          {refundSaid(answer, t, (amount) => formatMoney(amount, locale)).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {answer.pending.amountMinor > 0 && (
            <p className="mc-note" lang="en">
              {answer.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Something was missing at the counter: the merchant marks the lines and PayPal gives back what
 * the customer paid for them. The amount comes from the server's answer.
 */
export function Refund({
  tickets,
  onDone,
}: {
  tickets: readonly KitchenTicket[];
  onDone: () => void;
}) {
  const t = useMerchantT().refund;
  const orders = collected(tickets);
  const [orderId, setOrderId] = useState<string>('');
  const [lines, setLines] = useState<ReadonlySet<number>>(new Set());
  const [answer, setAnswer] = useState<RefundAnswer | null>(null);
  const [needsLine, setNeedsLine] = useState(false);
  const refund = useAction();
  const order = orders.find((candidate) => candidate.orderId === orderId) ?? orders[0];
  if (order === undefined) return <p className="mc-quiet">{t.none}</p>;
  const toggle = (index: number) => {
    const next = new Set(lines);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setLines(next);
    setNeedsLine(false);
  };
  const submit = () => {
    setAnswer(null);
    if (lines.size === 0) {
      setNeedsLine(true);
      return;
    }
    void refund
      .run(() => merchantApi.refund(order.orderId, [...lines]))
      .then((given) => {
        if (given === undefined) return;
        setAnswer(given);
        setLines(new Set());
        onDone();
      });
  };
  return (
    <form
      className="mc-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <label htmlFor="mc-refund-order">{t.order}</label>
        <select
          id="mc-refund-order"
          value={order.orderId}
          onChange={(event) => {
            setOrderId(event.target.value);
            setLines(new Set());
          }}
        >
          {orders.map((candidate) => (
            <option key={candidate.orderId} value={candidate.orderId}>
              {candidate.code} · {candidate.alias}
            </option>
          ))}
        </select>
      </div>
      <Lines ticket={order} chosen={lines} missing={needsLine} onToggle={toggle} />
      <ProblemNote failure={refund.failure} />
      <RefundSaid answer={answer} />
      <button type="submit" className="btn" disabled={refund.pending}>
        {refund.pending ? t.submitting : t.submit}
      </button>
    </form>
  );
}
