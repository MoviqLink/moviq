import type { Money } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { useMerchantT } from '../texts';

/** Refunds the merchant bears that no payout has deducted yet, said only when there are some. */
export function ToDeduct({ amount }: { amount: Money }) {
  const t = useMerchantT().payouts;
  const locale = useLocale();
  if (amount.amountMinor === 0) return null;
  return (
    <p className="mc-owed">
      <span>
        {t.owed}: <b>{formatMoney(amount, locale)}</b>
      </span>
      <span className="mc-note">{t.owedNote}</span>
    </p>
  );
}
