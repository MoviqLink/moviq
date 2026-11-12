import type { VirtualRide } from '@moviq/contracts';
import { useState } from 'react';
import { useNow } from '../../shared/time/clock';
import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { formatCityTime } from '../../shared/time/city';
import { useShopper } from '../rewards/useShopper';
import { ShopperForm } from '../rewards/ui/ShopperForm';
import { virtualApi } from './api';
import { useVirtualT } from './texts';

function Invitation({
  suggestion,
  busy,
  onAsk,
}: {
  suggestion: VirtualRide['stops'][number]['suggestions'][number];
  busy: boolean;
  onAsk: (id: string) => void;
}) {
  const t = useVirtualT();
  const locale = useLocale();
  const now = useNow();
  return (
    <div className="virtual-suggestion">
      <span>
        {suggestion.merchant.name} · {t.demo}
      </span>
      <strong>{suggestion.name}</strong>
      <span>
        {t.listPrice}: {formatMoney(suggestion.listPrice, locale)}
      </span>
      <span>
        {Date.parse(suggestion.expiresAt) <= now || suggestion.status === 'expired'
          ? t.expired
          : t.expires(
              formatCityTime(suggestion.expiresAt, locale),
              Math.ceil((Date.parse(suggestion.expiresAt) - now) / 60_000),
            )}
      </span>
      <button
        type="button"
        className="btn small"
        disabled={
          busy || suggestion.status === 'expired' || Date.parse(suggestion.expiresAt) <= now
        }
        onClick={() => {
          onAsk(suggestion.invitationId);
        }}
      >
        {busy ? t.asking : t.ask}
      </button>
    </div>
  );
}

export function Suggestions({
  ride,
  onRefresh,
  stale,
}: {
  ride: VirtualRide;
  onRefresh: () => void;
  stale: boolean;
}) {
  const t = useVirtualT();
  const lang = useLang();
  const locale = useLocale();
  const { shopper, save } = useShopper();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ask = async (invitationId: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await virtualApi.need(ride.id, { invitationId, ...shopper, language: lang });
      onRefresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="virtual-stops">
      <h3>{t.stops}</h3>
      {ride.stops.length === 0 && <p>{t.noStops}</p>}
      <ol>
        {ride.stops.map((stop) => (
          <li key={stop.id}>
            <strong>{stop.name}</strong>
            <p>
              {stop.arrival === null
                ? t.timeUnknown
                : `${t.offerTime}: ${formatCityTime(stop.arrival, locale)}`}
            </p>
            {!stale &&
              stop.suggestions.map((suggestion) => (
                <Invitation
                  key={suggestion.invitationId}
                  suggestion={suggestion}
                  busy={busy}
                  onAsk={(id) => {
                    void ask(id);
                  }}
                />
              ))}
          </li>
        ))}
      </ol>
      {ride.status === 'following' && ride.stops.every((stop) => stop.suggestions.length === 0) && (
        <p>{t.noInvites}</p>
      )}
      {failed && <p role="alert">{t.failed}</p>}
      <ShopperForm shopper={shopper} onSave={save} />
    </section>
  );
}
