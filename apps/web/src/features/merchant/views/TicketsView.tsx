import { useMemo, useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { DataGrid } from '../../../shared/ui/DataGrid';
import { useMediaQuery } from '../../../shared/ui/useMediaQuery';
import { merchantApi } from '../api';
import type { KitchenTicket } from '../schemas';
import { useMerchantT } from '../texts';
import { useAction } from '../useAction';
import { useResource } from '../useResource';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';
import { ProblemNote } from '../ui/ProblemNote';
import { ticketColumns, type TicketsContext } from './ticket-columns';

const NARROW = '(max-width: 720px)';

/** "Kitchen tickets": today's orders in AG Grid, moved forward by the kitchen. */
export function TicketsView() {
  const t = useMerchantT();
  const locale = useLocale();
  const tickets = useResource(merchantApi.tickets);
  const move = useAction();
  const [said, setSaid] = useState<string | null>(null);
  const narrow = useMediaQuery(NARROW);
  const columns = useMemo(() => ticketColumns(t, locale, narrow), [t, locale, narrow]);
  const onMove = (ticket: KitchenTicket, to: 'preparing' | 'ready') => {
    setSaid(null);
    void move
      .run(() => merchantApi.moveTicket(ticket.orderId, to))
      .then((moved) => {
        if (moved === undefined) return;
        setSaid(t.tickets.moved(ticket.code, t.status[moved.status]));
        tickets.reload();
      });
  };
  const context: TicketsContext = { t, locale, busy: move.pending, onMove };
  return (
    <>
      <Head title={t.tickets.title} lead={t.tickets.lead} receivedAt={tickets.receivedAt} />
      <ProblemNote failure={move.failure} />
      <p className="mc-said" role="status">
        {said}
      </p>
      <Loaded resource={tickets}>
        {(data) => (
          <DataGrid<KitchenTicket>
            rows={data}
            columns={columns}
            label={t.tickets.label}
            empty={t.tickets.empty}
            getRowId={({ data: row }) => row.orderId}
            context={context}
          />
        )}
      </Loaded>
    </>
  );
}
