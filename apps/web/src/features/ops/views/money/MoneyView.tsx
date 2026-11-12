import type { MoneyInDoubt } from '@moviq/contracts';
import { useMemo } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { formatMoney } from '../../../../shared/journey/money';
import { DataGrid } from '../../../../shared/ui/DataGrid';
import { Icon } from '../../../../shared/ui/Icon';
import { useMediaQuery } from '../../../../shared/ui/useMediaQuery';
import { opsApi } from '../../api';
import { ConnectionNotice } from '../../ui/ConnectionNotice';
import { PageHead } from '../../ui/PageHead';
import { useResource } from '../../useResource';
import { moneyColumns } from './columns';
import { useMoneyT } from './texts';

/** How many are open, how many escalated and how much money, with the rule that escalates. */
function MoneyTotals({ money }: { money: MoneyInDoubt }) {
  const t = useMoneyT();
  const locale = useLocale();
  const { totals, thresholds } = money;
  const items = [
    [t.open, String(totals.open), false],
    [t.escalated, String(totals.escalated), totals.escalated > 0],
    [t.amount, formatMoney(totals.amount, locale), false],
  ] as const;
  return (
    <section className="panel" aria-label={t.title}>
      <dl className="counts money-counts">
        {items.map(([label, value, alarm]) => (
          <div key={label} className={alarm ? 'count st-unavailable' : 'count'}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">{t.rule(thresholds.attempts, thresholds.hours)}</p>
    </section>
  );
}

/** The answer drawn: totals, then the grid, or a plain statement that nothing is in doubt. */
export function MoneyBody({ money, narrow }: { money: MoneyInDoubt; narrow: boolean }) {
  const t = useMoneyT();
  const columns = useMemo(() => moneyColumns(t, narrow), [t, narrow]);
  if (money.obligations.length === 0) {
    return (
      <section className="panel money-none" aria-labelledby="money-none">
        <p className="done" id="money-none">
          <Icon name="check" />
          {t.nothing}
        </p>
        <p className="hint">{t.nothingLead}</p>
      </section>
    );
  }
  return (
    <>
      <MoneyTotals money={money} />
      <DataGrid
        rows={[...money.obligations]}
        columns={columns}
        label={t.grid}
        empty={t.nothing}
        getRowId={({ data }) => data.id}
      />
    </>
  );
}

/** Every amount not settled with PayPal, escalated first, refreshed with the rest of the room. */
export function MoneyView() {
  const t = useMoneyT();
  const money = useResource('money', (signal) => opsApi.money(signal));
  const narrow = useMediaQuery('(max-width: 760px)');
  return (
    <section className="stack">
      <PageHead title={t.title} lead={t.lead} />
      <ConnectionNotice resource={money} />
      {money.data !== null && <MoneyBody money={money.data} narrow={narrow} />}
    </section>
  );
}
