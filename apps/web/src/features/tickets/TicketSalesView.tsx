import { useLang } from '../../shared/i18n/lang';
import { Head } from '../merchant/ui/Head';

/** Ticket demo sales use their own partner session, independent of restaurant access. */
export function TicketSalesView() {
  const es = useLang() === 'es';
  return (
    <>
      <Head
        title={es ? 'Ventas de transporte demo' : 'Demo transport sales'}
        lead={
          es
            ? 'Accede con el perfil de empresa de demostración.'
            : 'Use the demonstration business profile.'
        }
        receivedAt={null}
      />
      <p>
        <a href="#/business">{es ? 'Abrir panel de empresa' : 'Open business dashboard'}</a>
      </p>
    </>
  );
}
