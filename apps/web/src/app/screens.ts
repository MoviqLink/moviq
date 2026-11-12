import { lazy } from 'react';

/**
 * The screens loaded only when their address is opened, so the first load carries the home page
 * and not the maps (MapLibre) or the grids (AG Grid). Each one becomes its own file in the build.
 */
export const AgentsScreen = lazy(() =>
  import('../features/agents/AgentsScreen').then((module) => ({ default: module.AgentsScreen })),
);
export const TicketsScreen = lazy(() =>
  import('../features/tickets/TicketsScreen').then((module) => ({
    default: module.TicketsScreen,
  })),
);
export const PlanScreen = lazy(() =>
  import('../features/plan/PlanScreen').then((module) => ({ default: module.PlanScreen })),
);
export const TripScreen = lazy(() =>
  import('../features/trip/TripScreen').then((module) => ({ default: module.TripScreen })),
);
export const RewardsScreen = lazy(() =>
  import('../features/rewards/RewardsScreen').then((module) => ({
    default: module.RewardsScreen,
  })),
);
export const ExploreScreen = lazy(() =>
  import('../features/explore/ExploreScreen').then((module) => ({
    default: module.ExploreScreen,
  })),
);
export const CreditsScreen = lazy(() =>
  import('../features/credits/CreditsScreen').then((module) => ({
    default: module.CreditsScreen,
  })),
);
export const OpsApp = lazy(() =>
  import('../features/ops/OpsApp').then((module) => ({ default: module.OpsApp })),
);
export const MerchantApp = lazy(() =>
  import('../features/merchant/MerchantApp').then((module) => ({ default: module.MerchantApp })),
);

export const DashboardOverview = lazy(() =>
  import('../features/dashboard/Dashboard').then((module) => ({
    default: module.DashboardOverview,
  })),
);
export const WalletScreen = lazy(() =>
  import('../features/wallet/WalletScreen').then((module) => ({ default: module.WalletScreen })),
);
export const PaymentsScreen = lazy(() =>
  import('../features/wallet/PaymentsScreen').then((module) => ({
    default: module.PaymentsScreen,
  })),
);
export const RefundsScreen = lazy(() =>
  import('../features/wallet/RefundsScreen').then((module) => ({
    default: module.RefundsScreen,
  })),
);
export const MyTripsScreen = lazy(() =>
  import('../features/triplog/MyTripsScreen').then((module) => ({
    default: module.MyTripsScreen,
  })),
);
export const CalendarScreen = lazy(() =>
  import('../features/triplog/CalendarScreen').then((module) => ({
    default: module.CalendarScreen,
  })),
);
export const BusinessDashboard = lazy(() =>
  import('../features/demo/Dashboards').then((module) => ({ default: module.BusinessDashboard })),
);

export const SandboxHelpScreen = lazy(() =>
  import('../features/tickets/SandboxHelpScreen').then((module) => ({
    default: module.SandboxHelpScreen,
  })),
);
