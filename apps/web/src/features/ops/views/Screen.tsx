import type { OpsRoute } from '../routes';
import { AuditView } from './AuditView';
import { JobsView } from './JobsView';
import { MoneyView } from './money/MoneyView';
import { NotFound } from './NotFound';
import { SourceView } from './source/SourceView';
import { SourcesView } from './SourcesView';
import { SummaryView } from './summary/SummaryView';

/** The screen for a control room address. */
export function Screen({ route }: { route: OpsRoute }) {
  switch (route.name) {
    case 'summary':
      return <SummaryView />;
    case 'sources':
      return <SourcesView />;
    case 'source':
      return <SourceView key={route.id} id={route.id} />;
    case 'jobs':
      return <JobsView />;
    case 'money':
      return <MoneyView />;
    case 'audit':
      return <AuditView />;
    case 'not-found':
      return <NotFound />;
  }
}
