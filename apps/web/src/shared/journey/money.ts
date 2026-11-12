import type { Money } from '@moviq/contracts';

/** An amount set by the server, written in the reader's language: `$21.40` or `21,40 US$`. */
export function formatMoney(money: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    money.amountMinor / 100,
  );
}
