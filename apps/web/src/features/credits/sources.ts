import type { CreditGroup } from './credit';
import { maps, events, streets, weather } from './groups-city';
import { air, bikes, harbor, transit } from './groups-moving';

export type { Credit } from './credit';

/** Every source MovIQ uses, grouped by what it gives. */
export const CREDIT_GROUPS: readonly CreditGroup[] = [
  transit,
  bikes,
  air,
  harbor,
  streets,
  weather,
  events,
  maps,
];

/** The feeds the server reads on its own rhythm, each one in the credits once. */
export const catalogueSources = (groups: readonly CreditGroup[]): string[] =>
  groups.flatMap((group) => group.credits.flatMap((credit) => credit.sources));

/**
 * NYC DOT asks any application using its data to carry this text, word for word
 * (https://www.nyc.gov/html/dot/html/about/datafeeds.shtml#disclaimer, read on 11/11/2026).
 */
export const NYC_DOT_DISCLAIMER =
  'This application may contain and/or utilize information which was originally compiled by ' +
  'the New York City Department of Transportation (NYC DOT) for governmental purposes; the ' +
  'information may subsequently been modified by entity/entities other than NYC DOT. NYC DOT ' +
  'and the City of New York make no representation as to the accuracy or usefulness of the ' +
  "information provided by this application or the information's suitability for any purpose " +
  'and disclaim any liability for omissions or errors that may be contained therein. The public ' +
  'is advised to observe posted signage for compliance with applicable laws and regulations.';
