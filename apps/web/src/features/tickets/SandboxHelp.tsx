import { useLang } from '../../shared/i18n/lang';
import { SandboxBuyer } from './SandboxBuyer';
import './sandbox-help.css';

/** Instructions are available before PayPal opens its separate approval window. */
export function SandboxHelp({ standalone = false }: { readonly standalone?: boolean }) {
  const es = useLang() === 'es';
  return (
    <details className="sandbox-help" open={standalone || undefined}>
      <summary>{es ? 'Cómo probar PayPal Sandbox' : 'How to try PayPal Sandbox'}</summary>
      <div className="sandbox-help-content">
        <p>
          {es
            ? 'Esta compra es una demostración con PayPal Sandbox. ' +
              'Necesitas una cuenta de comprador de pruebas; una cuenta real de PayPal no sirve en este entorno.'
            : 'This purchase is a demonstration using PayPal Sandbox. ' +
              'You need a test buyer account; a real PayPal account cannot be used in this environment.'}
        </p>
        <p>
          {es
            ? 'Al pulsar PayPal se abrirá una ventana de autorización. ' +
              'Inicia sesión con la cuenta de pruebas y sigue los pasos allí. ' +
              'Después vuelve a MovIQ para comprobar el resultado.'
            : 'Selecting PayPal opens an approval window. Sign in with the test account and follow the steps there. ' +
              'Then return to MovIQ to check the result.'}
        </p>
        {!standalone && (
          <p>
            <a href="#/sandbox-help" target="_blank" rel="noopener noreferrer">
              {es ? 'Abrir ayuda en otra pestaña' : 'Open help in another tab'} ↗
            </a>
          </p>
        )}
        <SandboxBuyer />
      </div>
    </details>
  );
}
