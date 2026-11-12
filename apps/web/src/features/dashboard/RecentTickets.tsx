import { useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { DataGrid } from '../../shared/ui/DataGrid';
import { ticketColumns, type TicketItem } from './columns';

/** The latest ticket purchases in a compact grid, newest first. */
export default function RecentTickets({ items }: { readonly items: readonly TicketItem[] }) {
  const lang = useLang();
  const locale = useLocale();
  const es = lang === 'es';
  const columns = useMemo(() => {
    const { date, product, operator, amount, status } = ticketColumns(lang, locale, 'short');
    return [product, operator, amount, status, date];
  }, [lang, locale]);
  const rows = useMemo(
    () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [items],
  );
  return (
    <DataGrid<TicketItem>
      rows={rows}
      columns={columns}
      label={es ? 'Últimos billetes' : 'Latest tickets'}
      empty={es ? 'Sara aún no ha comprado billetes.' : 'Sara has not bought any tickets yet.'}
      getRowId={({ data }) => data.id}
    />
  );
}
