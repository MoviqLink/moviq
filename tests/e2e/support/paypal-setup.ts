import { startDeployment } from './global-setup.js';
import { PAYPAL_API_HOST, sandboxServerEnv, skipReason } from './paypal-sandbox.js';

/**
 * The deployment of `paypal.spec.ts`: payments on with the sandbox keys of `.env`, PayPal's API
 * reached for real through the stand-in, every other provider answered by its captures. Without
 * the keys and the buyer nothing starts: the run says what is missing and its tests are skipped.
 */
export default async function paypalSetup(): Promise<() => Promise<void>> {
  const reason = skipReason();
  if (reason !== undefined) {
    process.stderr.write(`${reason}\n`);
    return () => Promise.resolve();
  }
  return startDeployment({ env: sandboxServerEnv(), relayHosts: [PAYPAL_API_HOST] });
}
