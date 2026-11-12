import type { Money } from '@moviq/contracts';
import { useMemo, useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { DataGrid } from '../../../shared/ui/DataGrid';
import { merchantApi } from '../api';
import type { PayoutBoard, PayoutView } from '../schemas';
import { useMerchantT } from '../texts';
import { useAction } from '../useAction';
import { useResource } from '../useResource';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';
import { ProblemNote } from '../ui/ProblemNote';
import { ToDeduct } from '../ui/ToDeduct';
import { payoutColumns } from './payout-columns';

/** The payout account. A demo merchant's is fixed: the server answers 403, and the panel says so. */
function Account({ receiver }: { receiver: string }) {
  const t = useMerchantT().payouts;
  const change = useAction();
  const forbidden = change.failure?.kind === 'http' && change.failure.status === 403;
  return (
    <div className="mc-account">
      <p className="mc-label">{t.account}</p>
      <p className="mono mc-account-value">{receiver}</p>
      <button
        type="button"
        className="btn small"
        disabled={change.pending}
        onClick={() => {
          void change.run(() => merchantApi.changePayoutAccount(receiver));
        }}
      >
        {t.change}
      </button>
      {forbidden && (
        <div className="mc-problem" role="alert">
          <div>
            <p className="mc-problem-what">{t.locked}</p>
            <p className="mc-problem-todo">{t.lockedTodo}</p>
          </div>
        </div>
      )}
      {!forbidden && <ProblemNote failure={change.failure} />}
    </div>
  );
}

function PayNow({ board, onPaid }: { board: PayoutBoard; onPaid: () => void }) {
  const t = useMerchantT().payouts;
  const locale = useLocale();
  const pay = useAction();
  const [paid, setPaid] = useState<string | null>(null);
  return (
    <div className="mc-paynow">
      <button
        type="button"
        className="btn primary"
        disabled={!board.available || pay.pending}
        onClick={() => {
          setPaid(null);
          void pay.run(merchantApi.payNow).then((batch) => {
            if (batch === undefined) return;
            setPaid(t.paid(formatMoney(batch.net, locale)));
            onPaid();
          });
        }}
      >
        {pay.pending ? t.paying : t.payNow}
      </button>
      {!board.available && <p className="mc-note">{t.off}</p>}
      <p className="mc-said" role="status">
        {paid}
      </p>
      <ProblemNote failure={pay.failure} />
    </div>
  );
}

function Last({ batches, toDeduct }: { batches: readonly PayoutView[]; toDeduct: Money }) {
  const t = useMerchantT().payouts;
  const locale = useLocale();
  const [last] = [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="mc-hero" aria-label={t.last}>
      <p className="mc-label">{t.last}</p>
      {last === undefined ? (
        <>
          <p className="mc-number mc-number-quiet">{t.none}</p>
          <p className="mc-note">{t.noneBody}</p>
        </>
      ) : (
        <>
          <p className="mc-number">{formatMoney(last.net, locale)}</p>
          <p className="mc-note">{t.states[last.status]}</p>
        </>
      )}
      <ToDeduct amount={toDeduct} />
    </section>
  );
}

/** "Payouts": the last payout, the account, "get paid now" and every batch in AG Grid. */
export function PayoutsView() {
  const t = useMerchantT();
  const locale = useLocale();
  const board = useResource(merchantApi.payouts);
  const columns = useMemo(() => payoutColumns(t, locale), [t, locale]);
  return (
    <>
      <Head title={t.payouts.title} lead={t.payouts.lead} receivedAt={board.receivedAt} />
      <Loaded resource={board}>
        {(data) => (
          <div className="mc-stack">
            <div className="mc-columns">
              <Last batches={data.batches} toDeduct={data.refundsToDeduct} />
              <div className="mc-panel">
                <Account receiver={data.receiver} />
                <PayNow board={data} onPaid={board.reload} />
              </div>
            </div>
            <DataGrid<PayoutView>
              rows={data.batches}
              columns={columns}
              label={t.payouts.label}
              empty={t.payouts.none}
              getRowId={({ data: row }) => row.id}
            />
          </div>
        )}
      </Loaded>
    </>
  );
}
