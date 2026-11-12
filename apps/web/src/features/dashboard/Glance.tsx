import type { TripWallet } from '@moviq/contracts';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { SAMPLE_NOTICE, sampleStats } from '../triplog/sample';
import { RadialGauge } from './RadialGauge';
import { ON_TIME_BANDS, REROUTED_BANDS, WALLET_BANDS, percentOf } from './gauge';

export interface WalletResource {
  readonly data: TripWallet | null;
  readonly loading: boolean;
}

/** Three measures: trips on time and trips Sara re-routed (sample history), and wallet spent. */
export function Glance({ wallet }: { readonly wallet: WalletResource }) {
  const lang = useLang();
  const es = lang === 'es';
  const stats = sampleStats();
  return (
    <section className="dash-gauges" aria-labelledby="dash-gauges-title">
      <div className="dash-section-head">
        <div>
          <p className="dash-kicker">{es ? 'DE UN VISTAZO' : 'AT A GLANCE'}</p>
          <h2 id="dash-gauges-title">{es ? 'Cómo vas' : 'Where you stand'}</h2>
        </div>
      </div>
      <div className="gauge-row">
        <RadialGauge
          label={es ? 'Viajes a tiempo' : 'Trips on time'}
          percent={stats.onTimePercent}
          bands={ON_TIME_BANDS}
          caption={
            es
              ? `${String(stats.onTime)} de ${String(stats.trips)} viajes a tiempo`
              : `${String(stats.onTime)} of ${String(stats.trips)} trips on time`
          }
        />
        <RadialGauge
          label={es ? 'Viajes en que Sara intervino' : 'Trips where Sara stepped in'}
          percent={percentOf(stats.rerouted, stats.trips)}
          bands={REROUTED_BANDS}
          caption={
            es
              ? `Sara cambió la ruta en ${String(stats.rerouted)} de ${String(stats.trips)} viajes`
              : `Sara re-routed ${String(stats.rerouted)} of ${String(stats.trips)} trips`
          }
        />
        <WalletGauge wallet={wallet} />
      </div>
      <p className="dash-sample">
        <span aria-hidden="true">i</span>
        {SAMPLE_NOTICE[lang]}{' '}
        {es
          ? 'Los dos primeros medidores salen de él; el gasto es real.'
          : 'The first two gauges come from it; the spending is real.'}
      </p>
    </section>
  );
}

function WalletGauge({ wallet }: { readonly wallet: WalletResource }) {
  const es = useLang() === 'es';
  const locale = useLocale();
  const label = es ? 'Gastado de la billetera' : 'Wallet spent';
  const data = wallet.data;
  if (data === null) {
    return (
      <RadialGauge
        label={label}
        percent={null}
        bands={WALLET_BANDS}
        caption={
          wallet.loading
            ? es
              ? 'Consultando…'
              : 'Checking…'
            : es
              ? 'No disponible'
              : 'Unavailable'
        }
      />
    );
  }
  const added = data.added.amountMinor;
  return (
    <RadialGauge
      label={label}
      percent={percentOf(data.spent.amountMinor, added)}
      bands={WALLET_BANDS}
      caption={
        added <= 0
          ? es
            ? 'Aún no has añadido dinero'
            : 'No funds added yet'
          : es
            ? `${formatMoney(data.spent, locale)} gastados de ${formatMoney(data.added, locale)}`
            : `${formatMoney(data.spent, locale)} spent of ${formatMoney(data.added, locale)} added`
      }
    />
  );
}
