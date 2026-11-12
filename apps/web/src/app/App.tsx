import { Suspense, useEffect } from 'react';

import { useCreditsT } from '../features/credits/texts';
import { useExploreT } from '../features/explore/texts';
import { useTicketsT } from '../features/tickets/texts';
import { useDemoT } from '../features/demo/text';
import { EntryScreen } from '../features/demo/EntryScreen';
import { travellerEntered, useTravellerEntered } from '../features/demo/travellerSession';
import { HomeScreen } from '../features/home/HomeScreen';
import { openMovIq } from '../features/home/intro/once';
import { useHomeT } from '../features/home/texts';
import { savedTrips } from '../features/home/trips/saved';
import { useMerchantT } from '../features/merchant/texts';
import { useRewardsT } from '../features/rewards/texts';
import { usePlanT } from '../features/plan/texts';
import { useTripT } from '../features/trip/texts';
import { useT } from '../shared/i18n';
import { useHashSegments } from '../shared/routing/hash';
import { travellerHref } from '../shared/routing/hrefs';
import { SiteFooter } from '../shared/ui/SiteFooter';
import { TopBar } from '../shared/ui/TopBar';
import { ErrorBoundary } from './ErrorBoundary';
import { WelcomeScreen } from './WelcomeScreen';
import { DashboardShell, dashboardSection, type DashboardSection } from './DashboardShell';
import { parseAppPath, type AppRoute } from './routes';
import {
  AgentsScreen,
  SandboxHelpScreen,
  DashboardOverview,
  CalendarScreen,
  MyTripsScreen,
  PaymentsScreen,
  RefundsScreen,
  WalletScreen,
  BusinessDashboard,
  TicketsScreen,
  CreditsScreen,
  ExploreScreen,
  MerchantApp,
  OpsApp,
  PlanScreen,
  RewardsScreen,
  TripScreen,
} from './screens';
import { useAskSara } from './useAskSara';

/** The areas that are pages to read, with the foot that links the credits; maps fill the screen. */
const PAGES = new Set<AppRoute['area']>([
  'how-it-works',
  'dashboard',
  'plan',
  'agents',
  'tickets',
  'trips',
  'rewards',
  'credits',
  'not-found',
]);

function NotFound() {
  const t = useT().app;
  const home = useHomeT();
  return (
    <>
      <TopBar variant="solid" homeLabel={home.home} skipLabel={t.skip} />
      <main id="main" className="page" tabIndex={-1}>
        <h1>{t.notFoundTitle}</h1>
        <p className="muted">{t.notFoundBody}</p>
        <p>
          <a className="link" href={travellerHref.plan}>
            {t.notFoundLink}
          </a>
        </p>
      </main>
    </>
  );
}

/** While a screen's code arrives: one quiet line, nothing that moves. */
function Loading() {
  return (
    <p className="page muted" role="status">
      {useT().app.loading}
    </p>
  );
}

/** The home page, whose first words go to the conversation with Sara. */
function Home() {
  return <HomeScreen onAsk={useAskSara()} />;
}

/** The tab title for each area, in the language in use. */
function useDocumentTitle(route: AppRoute): void {
  const t = useT();
  const home = useHomeT();
  const demo = useDemoT();
  const titles: Record<AppRoute['area'], string> = {
    home: home.title,
    access: demo.entry,
    'how-it-works': home.title,
    dashboard: demo.welcome,
    business: demo.company,
    'sandbox-help': 'PayPal Sandbox',
    plan: usePlanT().title,
    trip: useTripT().title,
    rewards: useRewardsT().title,
    trips: home.trips.title,
    explore: useExploreT().title,
    agents: 'Agent',
    tickets: useTicketsT().title,
    credits: useCreditsT().title,
    ops: t.ops.title,
    merchant: useMerchantT().title,
    'not-found': t.app.notFoundTitle,
  };
  const title = `MovIQ · ${titles[route.area]}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Every trip opened in this browser goes to My trips; one that is not the traveller's leaves it. */
function useRememberTrip(route: AppRoute): void {
  const id = route.area === 'trip' ? route.id : null;
  useEffect(() => {
    if (id !== null) savedTrips.remember(id);
  }, [id]);
}

/** Routes by the address: see `routes.ts`. */
export function App() {
  const route = parseAppPath(useHashSegments());
  const section = dashboardSection(window.location.hash);
  // The first address of the load decides whether the intro plays; later ones change nothing.
  openMovIq(route.area === 'home' && !travellerEntered());
  useDocumentTitle(route);
  useRememberTrip(route);
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Screen route={route} section={section} />
      </Suspense>
      {PAGES.has(route.area) && <SiteFooter />}
    </ErrorBoundary>
  );
}

/** The screen of the address. */
function Screen({
  route,
  section,
}: {
  readonly route: AppRoute;
  readonly section: DashboardSection;
}) {
  const onAsk = useAskSara();
  const entered = useTravellerEntered();
  return (
    <>
      {route.area === 'home' && (entered ? <WelcomeScreen /> : <EntryScreen />)}
      {route.area === 'access' && <EntryScreen />}
      {route.area === 'how-it-works' && <Home />}
      {route.area === 'dashboard' && (
        <DashboardShell section={section}>
          {section === 'overview' && <DashboardOverview onAsk={onAsk} />}
          {section === 'wallet' && <WalletScreen />}
          {section === 'purchases' && <TicketsScreen wallet />}
          {section === 'payments' && <PaymentsScreen />}
          {section === 'refunds' && <RefundsScreen />}
          {section === 'trips' && <MyTripsScreen />}
          {section === 'calendar' && <CalendarScreen />}
          {section === 'rewards' && <RewardsScreen />}
        </DashboardShell>
      )}
      {route.area === 'business' && <BusinessDashboard />}
      {route.area === 'sandbox-help' && <SandboxHelpScreen />}
      {route.area === 'plan' && <PlanScreen />}
      {route.area === 'agents' && <AgentsScreen />}
      {route.area === 'tickets' &&
        (route.wallet ? (
          <DashboardShell section="purchases">
            <TicketsScreen wallet />
          </DashboardShell>
        ) : (
          <TicketsScreen wallet={false} />
        ))}
      {route.area === 'trip' && <TripScreen key={route.id} id={route.id} />}
      {route.area === 'trips' && (
        <DashboardShell section="trips">
          <MyTripsScreen />
        </DashboardShell>
      )}
      {route.area === 'rewards' && (
        <DashboardShell section="rewards">
          <RewardsScreen />
        </DashboardShell>
      )}
      {route.area === 'explore' && <ExploreScreen />}
      {route.area === 'credits' && <CreditsScreen />}
      {route.area === 'ops' && <OpsApp segments={route.segments} />}
      {route.area === 'merchant' && <MerchantApp segments={route.segments} />}
      {route.area === 'not-found' && <NotFound />}
    </>
  );
}
