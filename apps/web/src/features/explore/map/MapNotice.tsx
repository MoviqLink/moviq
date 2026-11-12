import { useLang } from '../../../shared/i18n/lang';
import './map-notice.css';

/** Keep map loading/failure visible above the mobile sheet, with an explicit retry. */
export function MapNotice({
  failed,
  failedText,
  onRetry,
}: {
  failed: boolean;
  failedText: string;
  onRetry: () => void;
}) {
  const es = useLang() === 'es';
  return (
    <div className="ex-map-notice" role="status">
      <p>{failed ? failedText : es ? 'Cargando el mapa…' : 'Loading the map…'}</p>
      {failed && (
        <button type="button" className="btn small" onClick={onRetry}>
          {es ? 'Reintentar mapa' : 'Retry map'}
        </button>
      )}
    </div>
  );
}
