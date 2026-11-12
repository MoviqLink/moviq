import type { Secret } from '../../config/secret.js';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { HoldContext, HoldOutcome } from '../payments/holds/hold-context.js';
import type { PayPalPayouts } from '../payments/payouts/payouts-setup.js';
import type { PaymentsSetup } from '../payments/setup.js';
import type { MerchantAgent } from './agent.js';
import type { MerchantTalk } from './agent-talk.js';
import { commercePurchases } from './hold-purchases.js';
import type { CommerceContext } from './negotiation.js';
import type { CommerceSettings } from './settings.js';

/** Everything the commerce API needs, built once by the process. */
export interface CommerceDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly settings: CommerceSettings;
  /** The merchant's agent on the language model when there is a key, its rules otherwise. */
  readonly agent: MerchantAgent;
  /** The agent talking with its merchant in "Your agent", only when there is a language model. */
  readonly talk?: MerchantTalk | undefined;
  readonly payments: PaymentsSetup;
  /** PayPal Payouts, when PayPal is set up. */
  readonly payouts: PayPalPayouts | undefined;
  readonly secureCookies: boolean;
  readonly merchantAccessToken?: Secret | undefined;
}

export function commerceContext(deps: CommerceDependencies, logger: Logger): CommerceContext {
  return { db: deps.db, clock: deps.clock, logger, settings: deps.settings, agent: deps.agent };
}

/** The hold steps for a request, or undefined when PayPal is not set up on this server. */
export function holdContext(deps: CommerceDependencies, logger: Logger): HoldContext | undefined {
  if (!deps.payments.available) return undefined;
  return {
    db: deps.db,
    clock: deps.clock,
    logger,
    paypal: deps.payments.paypal,
    purchases: commercePurchases({ clock: deps.clock }),
    source: 'api',
    write: (work) => deps.db.transaction(work),
  };
}

export function paymentsReason(deps: CommerceDependencies): string {
  return deps.payments.available ? 'PayPal is not available right now.' : deps.payments.reason;
}

/** HTTP status of a hold step: done 200, still unknown 202, refused 409, PayPal unreachable 503. */
export function holdStatus(outcome: HoldOutcome): 200 | 202 | 409 | 503 {
  if (!outcome.ok) return outcome.reason === 'unavailable' ? 503 : 409;
  return outcome.hold.status === 'unknown' ? 202 : 200;
}
