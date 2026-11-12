import { TopBar } from '../../shared/ui/TopBar';
import { Capabilities } from './Capabilities';
import { Conversation } from './Conversation';
import { Permissions } from './Permissions';
import { useAgentsT } from './texts';
import { usePayPal } from './usePayPal';
import { useWorkspace } from './useWorkspace';
import { Watches } from './Watches';
import './agents.css';

export function AgentsScreen() {
  const t = useAgentsT();
  const workspace = useWorkspace();
  const paypal = usePayPal();
  const { detail } = workspace;
  return (
    <>
      <TopBar variant="solid" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" tabIndex={-1} className="agents">
        <header className="agents-intro">
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
        </header>
        <Capabilities paypal={paypal} />
        <div className="agents-layout">
          <div className="agents-main">
            {workspace.failed && (
              <p role="alert">
                {t.loadFailed}{' '}
                <button type="button" onClick={workspace.retry}>
                  {t.refresh}
                </button>
              </p>
            )}
            {detail !== null && <Conversation detail={detail} onChange={workspace.change} />}
          </div>
          <div className="agents-side">
            <Permissions paypal={paypal} />
          </div>
        </div>
        {detail !== null && <Watches detail={detail} onChange={workspace.change} />}
      </main>
    </>
  );
}
