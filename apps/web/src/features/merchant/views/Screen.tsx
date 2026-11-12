import type { MerchantRoute } from '../routes';
import { merchantHref } from '../routes';
import { useMerchantT } from '../texts';
import { AgentView } from './AgentView';
import { CustomersView } from './CustomersView';
import { PayoutsView } from './PayoutsView';
import { RequestsView } from './RequestsView';
import { ScanView } from './ScanView';
import { TicketsView } from './TicketsView';
import { TodayView } from './TodayView';
import { VirtualMetricsView } from '../../virtual/VirtualMetricsView';
import { TicketSalesView } from '../../tickets/TicketSalesView';

/** The screen for the address; an unknown one says so and leads back to Today. */
export function Screen({ route }: { route: MerchantRoute }) {
  const t = useMerchantT();
  switch (route.name) {
    case 'today':
      return <TodayView />;
    case 'requests':
      return <RequestsView threadId={route.threadId} />;
    case 'tickets':
      return <TicketsView />;
    case 'scan':
      return <ScanView />;
    case 'customers':
      return <CustomersView />;
    case 'payouts':
      return <PayoutsView />;
    case 'agent':
      return <AgentView />;
    case 'ticket-sales':
      return <TicketSalesView />;
    case 'virtual-visitors':
      return <VirtualMetricsView />;
    case 'not-found':
      return (
        <p className="mc-quiet">
          {t.problem.missing}{' '}
          <a className="link" href={merchantHref.today}>
            {t.nav.today}
          </a>
        </p>
      );
  }
}
