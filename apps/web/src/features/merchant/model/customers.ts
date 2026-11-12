import type { NeedMessage } from '@moviq/contracts';

import type { MerchantRequest } from '../schemas';

/**
 * The need Sara sent this merchant most recently for each alias. Its preferences are the only
 * tags a customer shows: what the menu can touch, never anything that identifies the traveller.
 */
export function latestNeeds(
  requests: readonly MerchantRequest[],
): ReadonlyMap<string, NeedMessage> {
  const latest = new Map<string, { readonly at: string; readonly need: NeedMessage }>();
  for (const request of requests) {
    const need = request.conversation.find((entry) => entry.message.type === 'need')?.message;
    if (need?.type !== 'need') continue;
    const seen = latest.get(request.alias);
    if (seen === undefined || request.at > seen.at)
      latest.set(request.alias, { at: request.at, need });
  }
  return new Map([...latest].map(([alias, { need }]) => [alias, need]));
}
