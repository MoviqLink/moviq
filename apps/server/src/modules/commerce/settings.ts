import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { Secret } from '../../config/secret.js';

/** The program's rules for commerce, read once at start-up. */
export interface CommerceSettings {
  /** Every offer must be at least this much cheaper than the menu, in whole percent. */
  readonly minRewardPercent: number;
  /** Questions a merchant's agent may ask before the need closes without an offer. */
  readonly maxClarifications: number;
  /** Offers a merchant's agent may compose for one need before the server stops asking. */
  readonly maxOfferAttempts: number;
  /** MovIQ's commission on each payout, in whole percent. */
  readonly payoutFeePercent: number;
  /** Signs pickup codes. Without `ORDER_CODE_SECRET` outside production, one per process. */
  readonly codeSecret: Secret;
  readonly codeSecretIsEphemeral: boolean;
}

export type CommerceSettingsResult =
  | { readonly ok: true; readonly settings: CommerceSettings }
  | { readonly ok: false; readonly problems: readonly string[] };

const blank = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const percent = (fallback: number, min: number, max: number) =>
  z.preprocess(
    blank,
    z
      .string()
      .default(String(fallback))
      .pipe(
        z.string().regex(/^\d{1,3}$/, {
          error: `must be a whole number from ${String(min)} to ${String(max)}`,
        }),
      )
      .transform(Number)
      .pipe(z.number().min(min).max(max)),
  );

const envSchema = z.object({
  APP_ENV: z.preprocess(
    blank,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  MIN_REWARD_PERCENT: percent(10, 1, 50),
  COMMERCE_MAX_CLARIFICATIONS: percent(2, 0, 5),
  COMMERCE_MAX_OFFER_ATTEMPTS: percent(3, 1, 5),
  PAYOUT_FEE_PERCENT: percent(5, 0, 30),
  ORDER_CODE_SECRET: z.preprocess(
    blank,
    z.string().min(32, { error: 'must have at least 32 characters' }).optional(),
  ),
});

/** The variables commerce reads besides `APP_ENV`, which the configuration owns. */
export function commerceVariableNames(): readonly string[] {
  return Object.keys(envSchema.shape).filter((name) => name !== 'APP_ENV');
}

/**
 * Reads the commerce settings. Production needs `ORDER_CODE_SECRET`, so codes shown before a
 * restart still scan after it; elsewhere a missing secret is generated for the process.
 */
export function commerceSettings(
  env: Readonly<Record<string, string | undefined>>,
): CommerceSettingsResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`),
    };
  }
  const values = parsed.data;
  if (values.APP_ENV === 'production' && values.ORDER_CODE_SECRET === undefined) {
    return { ok: false, problems: ['ORDER_CODE_SECRET must be set in production'] };
  }
  return {
    ok: true,
    settings: {
      minRewardPercent: values.MIN_REWARD_PERCENT,
      maxClarifications: values.COMMERCE_MAX_CLARIFICATIONS,
      maxOfferAttempts: values.COMMERCE_MAX_OFFER_ATTEMPTS,
      payoutFeePercent: values.PAYOUT_FEE_PERCENT,
      codeSecret: new Secret(values.ORDER_CODE_SECRET ?? randomBytes(32).toString('base64url')),
      codeSecretIsEphemeral: values.ORDER_CODE_SECRET === undefined,
    },
  };
}
