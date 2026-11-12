import type { AppConfig } from './config/config.js';
import type { Clock } from './infrastructure/clock/clock.js';
import type { Database } from './infrastructure/database/database.js';
import type { HttpClient } from './infrastructure/http/client.js';
import type { Logger } from './infrastructure/telemetry/logger.js';
import type { TokenBudget } from './modules/assistant/budget.js';
import type { LanguageModel } from './modules/assistant/model/language-model.js';
import type { CommerceDependencies } from './modules/commerce/context.js';
import { commerceSetup } from './modules/commerce/setup.js';
import { commerceSettings } from './modules/commerce/settings.js';
import type { PaymentsSetup } from './modules/payments/setup.js';

/**
 * Commerce on the way for one process, the API or the worker: the program's rules read from the
 * environment and checked at start-up (a process with wrong rules does not start), then the
 * merchant's agent and PayPal Payouts.
 */
export function commerceServices(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config: Pick<AppConfig, 'integrations' | 'paypalEnv' | 'appEnv' | 'merchantAccessToken'>;
  readonly db: Database;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly logger: Logger;
  readonly payments: PaymentsSetup;
  /** The merchant's agent on the model; undefined in the worker, which only pays merchants. */
  readonly model: LanguageModel | undefined;
  readonly budget: TokenBudget;
}): CommerceDependencies {
  const read = commerceSettings(input.env);
  if (!read.ok) throw new Error(`Commerce settings are invalid: ${read.problems.join('; ')}`);
  if (read.settings.codeSecretIsEphemeral) {
    input.logger.warn('pickup codes are signed with a key of this process', {
      reason: 'ORDER_CODE_SECRET is not set; codes shown before a restart will not scan after it',
    });
  }
  return commerceSetup({
    config: input.config,
    settings: read.settings,
    db: input.db,
    clock: input.clock,
    http: input.http,
    logger: input.logger,
    payments: input.payments,
    model: input.model,
    budget: input.budget,
    secureCookies: input.config.appEnv === 'production',
    merchantAccessToken: input.config.merchantAccessToken,
  });
}
