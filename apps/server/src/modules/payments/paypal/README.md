# PayPal client

`createPayPalClient` implements `PayPalGateway` over the shared HTTP client (generic network
identity, time-outs, size limits). The base URL follows `PAYPAL_ENV`: `api-m.sandbox.paypal.com`
or `api-m.paypal.com`.

| File            | Responsibility                                                                   |
| --------------- | -------------------------------------------------------------------------------- |
| `gateway.ts`    | The interface: Orders v2, Payments v2 (refunds read back too), webhooks          |
| `client.ts`     | The implementation of the interface                                              |
| `transport.ts`  | Calls with the OAuth2 client-credentials token cached until expiry               |
| `order-body.ts` | The order body; with a presentation, `brand_name`, `locale`, items and breakdown |
| `payouts.ts`    | Payouts v1: create a batch, read it back                                         |
| `schemas.ts`    | Zod schemas of the answers MovIQ reads; amounts become integer cents             |
| `errors.ts`     | `PayPalError`: whether money may have moved (`refused`, `not_done`, `unknown`)   |

- **Idempotency.** Every call that moves money takes a `requestId`, sent as `PayPal-Request-Id`,
  and PayPal returns its first answer to a repeat while it keeps the key: 6 hours in Orders v2
  (its reference), 45 days for a refund of a capture (developer.paypal.com/api/rest/requests/).
  MovIQ reads the resource back before acting again; a refund carries its own `custom_id` too.
- **Token.** Fetched once for concurrent callers and renewed a minute before it expires. A `401`
  on a call renews it and repeats the call with the same request id (PayPal refused before
  acting).
- **Errors.** A `4xx` answer is `refused`, with PayPal's `issue` (`ORDER_NOT_APPROVED`,
  `INSTRUMENT_DECLINED`, `ORDER_ALREADY_CAPTURED`…) and `debug_id`. A `429`, or no token, is
  `not_done`. A time-out, a network error, a `5xx`, a 409 `PREVIOUS_REQUEST_IN_PROGRESS` or an
  answer that does not match its schema is `unknown`: PayPal may have acted.
- **Webhooks.** The event is sent back to `/v1/notifications/verify-webhook-signature` byte for
  byte as it arrived, so PayPal checks exactly what it signed.

References: Orders v2 and Payments v2 (developer.paypal.com/docs/api/), their errors
(developer.paypal.com/api/rest/reference/orders/v2/errors/), idempotency
(developer.paypal.com/api/rest/reference/idempotency/) and the OpenAPI specifications in
github.com/paypal/paypal-rest-api-specifications. Tested in `tests/payments/paypal-*.test.ts`.
