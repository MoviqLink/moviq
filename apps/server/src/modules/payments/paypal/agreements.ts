import { z } from 'zod';

import { parsed, requester, type PayPalClientOptions } from './transport.js';

/**
 * PayPal billing agreements: the buyer approves once, and from then on an order can be charged
 * to that agreement with no PayPal window. It is what lets the assistant pay for a ticket.
 */
export interface PayPalAgreements {
  /** Opens the approval. The buyer agrees at `approvalUrl` and comes back with the token. */
  createToken(input: {
    /** Shown to the buyer in PayPal: it must carry no personal data and no internal ids. */
    readonly description: string;
    readonly returnUrl: string;
    readonly cancelUrl: string;
  }): Promise<{ readonly tokenId: string; readonly approvalUrl: string }>;
  /** Turns a token the buyer approved into the agreement orders are charged to. */
  create(tokenId: string): Promise<{ readonly id: string }>;
  /** Ends the agreement in PayPal: nothing can be charged to it afterwards. */
  cancel(agreementId: string): Promise<void>;
}

const tokenSchema = z.object({
  token_id: z.string().min(1),
  links: z.array(z.object({ href: z.url(), rel: z.string() })),
});
const agreementSchema = z.object({ id: z.string().min(1) });

const BASE = '/v1/billing-agreements';

export function createPayPalAgreements(options: PayPalClientOptions): PayPalAgreements {
  const request = requester(options);
  return {
    async createToken(input) {
      const token = await parsed(request, tokenSchema, {
        operation: 'agreements.token',
        method: 'POST',
        path: `${BASE}/agreement-tokens`,
        body: JSON.stringify({
          description: input.description,
          payer: { payment_method: 'PAYPAL' },
          plan: {
            type: 'MERCHANT_INITIATED_BILLING',
            merchant_preferences: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              accepted_pymt_type: 'INSTANT',
              skip_shipping_address: true,
            },
          },
        }),
      });
      const approval = token.links.find((link) => link.rel === 'approval_url');
      if (approval === undefined) throw new Error('PayPal returned no approval address.');
      return { tokenId: token.token_id, approvalUrl: approval.href };
    },
    create: (tokenId) =>
      parsed(request, agreementSchema, {
        operation: 'agreements.create',
        method: 'POST',
        path: `${BASE}/agreements`,
        body: JSON.stringify({ token_id: tokenId }),
      }),
    async cancel(agreementId) {
      await request({
        operation: 'agreements.cancel',
        method: 'POST',
        path: `${BASE}/agreements/${encodeURIComponent(agreementId)}/cancel`,
        body: JSON.stringify({ note: 'Disconnected by the traveller.' }),
      });
    },
  };
}
