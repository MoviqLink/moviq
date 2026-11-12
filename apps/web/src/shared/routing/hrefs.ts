import type { Lang } from '../i18n/lang';

/** Addresses of the traveller's screens, so features link to each other without importing them. */
export const travellerHref = {
  home: '#/',
  plan: '#/plan',
  dashboard: '#/dashboard',
  agents: '#/agents',
  tickets: '#/tickets',
  ticketWallet: '#/tickets/wallet',
  explore: '#/explore',
  trips: '#/trips',
  rewards: '#/rewards',
  trip: (id: string) => `#/trip/${encodeURIComponent(id)}`,
  /** The credits page has an address in each language; both open it. */
  credits: (lang: Lang) => (lang === 'es' ? '#/creditos' : '#/credits'),
} as const;

/** The three places of the traveller's navigation. */
export type TravellerSection = 'dashboard' | 'agents' | 'explore';

/**
 * Which place of the navigation an address belongs to: the home page and the conversation are
 * Sara's, a trip belongs to the traveller's trips, and anything else to none of them.
 */
export function travellerSection(segments: readonly string[]): TravellerSection | null {
  const [area] = segments;
  if (
    area === 'dashboard' ||
    area === 'trips' ||
    area === 'trip' ||
    area === 'rewards' ||
    area === 'tickets'
  )
    return 'dashboard';
  if (area === 'agents') return 'agents';
  if (area === 'explore') return 'explore';
  return null;
}
