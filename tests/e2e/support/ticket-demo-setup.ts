import { startDeployment } from './global-setup.js';
import { PAYPAL_API_HOST, sandboxServerEnv, skipReason } from './paypal-sandbox.js';

/** A disposable deployment with the explicitly opt-in ticket demo and PayPal Sandbox only. */
export default async function ticketDemoSetup(): Promise<() => Promise<void>> {
  const reason = skipReason();
  if (reason !== undefined) {
    process.stderr.write(`${reason}\n`);
    return () => Promise.resolve();
  }
  return startDeployment({
    env: { ...sandboxServerEnv(), TICKET_DEMO_ENABLED: 'true' },
    relayHosts: [PAYPAL_API_HOST],
  });
}
