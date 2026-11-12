import type { AppConfig } from '../../config/config.js';
import type { Secret } from '../../config/secret.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { HttpClient } from '../../infrastructure/http/client.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { TokenBudget } from '../assistant/budget.js';
import type { LanguageModel } from '../assistant/model/language-model.js';
import { payoutsSetup } from '../payments/payouts/payouts-setup.js';
import type { PaymentsSetup } from '../payments/setup.js';
import type { MerchantAgent } from './agent.js';
import { modelTalk } from './agent-talk.js';
import type { CommerceDependencies } from './context.js';
import { modelAgent } from './model-agent.js';
import { rulesAgent } from './rules-agent.js';
import type { CommerceSettings } from './settings.js';

/**
 * Builds commerce from the configuration: the merchant's agent on the language model when there
 * is one (Sara's interface, Sara's daily budget), its rules otherwise, and its talk with the
 * merchant only with the model; PayPal Payouts with the same credentials as payments. Building
 * it starts nothing.
 */
export function commerceSetup(input: {
  readonly config: Pick<AppConfig, 'integrations' | 'paypalEnv'>;
  readonly settings: CommerceSettings;
  readonly db: Database;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly logger: Logger;
  readonly payments: PaymentsSetup;
  readonly model: LanguageModel | undefined;
  readonly budget: TokenBudget;
  readonly secureCookies: boolean;
  readonly merchantAccessToken?: Secret | undefined;
}): CommerceDependencies {
  const agent: MerchantAgent =
    input.model === undefined
      ? rulesAgent
      : modelAgent({ model: input.model, budget: input.budget, logger: input.logger });
  const talk =
    input.model === undefined
      ? undefined
      : modelTalk({ model: input.model, budget: input.budget, logger: input.logger });
  const payouts = payoutsSetup({ config: input.config, http: input.http, clock: input.clock });
  return {
    db: input.db,
    clock: input.clock,
    settings: input.settings,
    agent,
    talk,
    payments: input.payments,
    payouts,
    secureCookies: input.secureCookies,
    merchantAccessToken: input.merchantAccessToken,
  };
}
