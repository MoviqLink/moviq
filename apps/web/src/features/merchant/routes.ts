/** The merchant panel's screens, read from the address after `#/merchant`. */
export type MerchantRoute =
  | { readonly name: 'today' }
  | { readonly name: 'requests'; readonly threadId: string | null }
  | { readonly name: 'tickets' }
  | { readonly name: 'scan' }
  | { readonly name: 'customers' }
  | { readonly name: 'payouts' }
  | { readonly name: 'agent' }
  | { readonly name: 'ticket-sales' }
  | { readonly name: 'virtual-visitors' }
  | { readonly name: 'not-found' };

/** The sections of the panel, in the order of its navigation. */
export const MERCHANT_SECTIONS = [
  'today',
  'requests',
  'tickets',
  'scan',
  'customers',
  'payouts',
  'agent',
  'ticket-sales',
  'virtual-visitors',
] as const;

export type MerchantSection = (typeof MERCHANT_SECTIONS)[number];

const SINGLE = new Set<string>(MERCHANT_SECTIONS.filter((section) => section !== 'requests'));

function decode(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded === '' ? null : decoded;
  } catch {
    return null;
  }
}

const isSingle = (section: string): section is Exclude<MerchantSection, 'requests'> =>
  SINGLE.has(section);

/** The screen for the path segments that follow `merchant`; the bare address opens Today. */
export function parseMerchantPath(segments: readonly string[]): MerchantRoute {
  const [section, id, ...rest] = segments;
  if (section === undefined) return { name: 'today' };
  if (rest.length > 0) return { name: 'not-found' };
  if (section === 'requests') {
    if (id === undefined) return { name: 'requests', threadId: null };
    const threadId = decode(id);
    return threadId === null ? { name: 'not-found' } : { name: 'requests', threadId };
  }
  if (id === undefined && isSingle(section)) return { name: section };
  return { name: 'not-found' };
}

export const merchantHref = {
  today: '#/merchant',
  requests: '#/merchant/requests',
  request: (threadId: string) => `#/merchant/requests/${encodeURIComponent(threadId)}`,
  tickets: '#/merchant/tickets',
  scan: '#/merchant/scan',
  customers: '#/merchant/customers',
  payouts: '#/merchant/payouts',
  agent: '#/merchant/agent',
  'ticket-sales': '#/merchant/ticket-sales',
  'virtual-visitors': '#/merchant/virtual-visitors',
} as const satisfies Record<MerchantSection | 'request', string | ((id: string) => string)>;

/** The navigation section an address belongs to. */
export function sectionOf(route: MerchantRoute): MerchantSection | null {
  return route.name === 'not-found' ? null : route.name;
}
