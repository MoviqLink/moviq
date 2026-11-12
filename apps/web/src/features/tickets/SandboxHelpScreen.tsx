import { useLang } from '../../shared/i18n/lang';
import { useHomeT } from '../home/texts';
import { TopBar } from '../../shared/ui/TopBar';
import { SandboxHelp } from './SandboxHelp';

/** A separate page for keeping the test-account instructions alongside the PayPal window. */
export function SandboxHelpScreen() {
  const es = useLang() === 'es';
  const home = useHomeT();
  return (
    <>
      <TopBar variant="solid" homeLabel={home.home} skipLabel={home.skip} />
      <main id="main" className="page" tabIndex={-1}>
        <h1>{es ? 'Ayuda de PayPal Sandbox' : 'PayPal Sandbox help'}</h1>
        <SandboxHelp standalone />
        <p>
          <a className="link" href="#/tickets">
            {es ? 'Volver a billetes' : 'Back to tickets'}
          </a>
        </p>
      </main>
    </>
  );
}
