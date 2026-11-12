import type { ReactNode } from 'react';
import { useLang } from '../shared/i18n/lang';
import { useT } from '../shared/i18n';
import { TopBar } from '../shared/ui/TopBar';
import { useHomeT } from '../features/home/texts';
import './dashboard-nav.css';

export type DashboardSection =
  'overview' | 'wallet' | 'purchases' | 'payments' | 'refunds' | 'trips' | 'calendar' | 'rewards';
/** The tabs, in order. `rewards` keeps its address but is not one of them. */
const MENU = [
  'overview',
  'wallet',
  'purchases',
  'payments',
  'refunds',
  'trips',
  'calendar',
] as const satisfies readonly DashboardSection[];
const SECTIONS: readonly DashboardSection[] = [...MENU, 'rewards'];
const WORDS = {
  en: {
    label: 'Dashboard sections',
    overview: 'Overview',
    wallet: 'Wallet',
    purchases: 'My tickets',
    payments: 'Payments',
    refunds: 'Refunds',
    trips: 'My trips',
    calendar: 'Calendar',
  },
  es: {
    label: 'Secciones del panel',
    overview: 'Resumen',
    wallet: 'Billetera',
    purchases: 'Mis billetes',
    payments: 'Pagos',
    refunds: 'Reembolsos',
    trips: 'Mis viajes',
    calendar: 'Calendario',
  },
} as const;

export function dashboardSection(hash: string): DashboardSection {
  const section = new URLSearchParams(hash.split('?')[1] ?? '').get('section');
  return SECTIONS.find((value) => value === section) ?? 'overview';
}

export function DashboardShell({
  section,
  children,
}: {
  readonly section: DashboardSection;
  readonly children: ReactNode;
}) {
  const t = WORDS[useLang()];
  const home = useHomeT();
  const skip = useT().app.skip;
  return (
    <>
      <TopBar variant="solid" homeLabel={home.home} skipLabel={skip} />
      <nav className="dashboard-nav" aria-label={t.label}>
        {MENU.map((item) => (
          <a
            key={item}
            href={item === 'overview' ? '#/dashboard' : `#/dashboard?section=${item}`}
            aria-current={item === section ? 'page' : undefined}
          >
            {t[item]}
          </a>
        ))}
      </nav>
      {children}
    </>
  );
}
