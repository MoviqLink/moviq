/** The areas of the web, read from the address after `#/`. */
export type AppRoute =
  | { readonly area: 'home' }
  | { readonly area: 'access' }
  | { readonly area: 'how-it-works' }
  | { readonly area: 'dashboard' }
  | { readonly area: 'business' }
  | { readonly area: 'sandbox-help' }
  | { readonly area: 'plan' }
  | { readonly area: 'agents' }
  | { readonly area: 'tickets'; readonly wallet: boolean }
  | { readonly area: 'trip'; readonly id: string }
  | { readonly area: 'trips' }
  | { readonly area: 'rewards' }
  | { readonly area: 'explore' }
  | { readonly area: 'credits' }
  | { readonly area: 'ops'; readonly segments: readonly string[] }
  | { readonly area: 'merchant'; readonly segments: readonly string[] }
  | { readonly area: 'not-found' };

/** Addresses of one segment, each opening one area; the credits have one in each language. */
const PAGES = new Map<string, AppRoute>([
  ['access', { area: 'access' }],
  ['how-it-works', { area: 'how-it-works' }],
  ['dashboard', { area: 'dashboard' }],
  ['business', { area: 'business' }],
  ['sandbox-help', { area: 'sandbox-help' }],
  ['plan', { area: 'plan' }],
  ['agents', { area: 'agents' }],
  ['tickets', { area: 'tickets', wallet: false }],
  ['trips', { area: 'trips' }],
  ['rewards', { area: 'rewards' }],
  ['explore', { area: 'explore' }],
  ['credits', { area: 'credits' }],
  ['creditos', { area: 'credits' }],
]);

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * `#/` is home (or access before entry), `#/access` selects a profile, `#/plan` the conversation,
 * `#/trip/<id>` a trip, `#/trips` the
 * traveller's trips, `#/rewards` the rewards on the way and My orders, `#/explore` the city live,
 * `#/credits` (or `#/creditos`) the credits and `#/ops/…` the control room; `#/merchant/…` is the
 * demo merchants' panel.
 */
export function parseAppPath(segments: readonly string[]): AppRoute {
  const [area, id, ...rest] = segments;
  if (area === undefined) return { area: 'home' };
  if (area === 'ops') return { area: 'ops', segments: segments.slice(1) };
  if (area === 'merchant') return { area: 'merchant', segments: segments.slice(1) };
  if (area === 'tickets') {
    if (id === undefined) return { area: 'tickets', wallet: false };
    if (id === 'wallet' && rest.length === 0) return { area: 'tickets', wallet: true };
    return { area: 'not-found' };
  }
  const page = PAGES.get(area);
  if (page !== undefined) return id === undefined ? page : { area: 'not-found' };
  if (area === 'trip' && id !== undefined && rest.length === 0) {
    const decoded = decode(id);
    if (decoded !== null && decoded !== '') return { area: 'trip', id: decoded };
  }
  return { area: 'not-found' };
}
