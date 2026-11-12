import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/app/${path}`, import.meta.url)), 'utf8');

/** Every module a file imports statically (`import … from '…'`), types left out. */
function staticImports(code: string): string[] {
  return [...code.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gms)].map(
    (match) => match[1] ?? '',
  );
}

describe('screens loaded on demand', () => {
  it('keeps the maps, the grids and every screen but the home page out of the first load', () => {
    const app = staticImports(source('App.tsx'));
    const screens = app.filter((path) => /Screen$|App$/.test(path));
    expect(screens).toEqual([
      '../features/demo/EntryScreen',
      '../features/home/HomeScreen',
      './WelcomeScreen',
    ]);
    expect(app).toContain('./screens');
  });

  it('imports each screen of `screens.ts` only through React.lazy', () => {
    const code = source('screens.ts');
    expect(staticImports(code)).toEqual(['react']);
    const lazy = [...code.matchAll(/lazy\(\(\) =>\s*import\('([^']+)'\)/g)].map((m) => m[1]);
    expect(lazy).toEqual([
      '../features/agents/AgentsScreen',
      '../features/tickets/TicketsScreen',
      '../features/plan/PlanScreen',
      '../features/trip/TripScreen',
      '../features/rewards/RewardsScreen',
      '../features/explore/ExploreScreen',
      '../features/credits/CreditsScreen',
      '../features/ops/OpsApp',
      '../features/merchant/MerchantApp',
      '../features/dashboard/Dashboard',
      '../features/wallet/WalletScreen',
      '../features/wallet/PaymentsScreen',
      '../features/wallet/RefundsScreen',
      '../features/triplog/MyTripsScreen',
      '../features/triplog/CalendarScreen',
      '../features/demo/Dashboards',
      '../features/tickets/SandboxHelpScreen',
    ]);
  });
});
