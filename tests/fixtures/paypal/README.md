# PayPal fixtures

Official examples from PayPal's API reference, copied verbatim (only re-indented). Payments are
never captured from real accounts: these bodies are PayPal's own. They were taken on
2026-11-11 from the OpenAPI specifications in
[paypal/paypal-rest-api-specifications](https://github.com/paypal/paypal-rest-api-specifications)
(commit `90e8041`, 2026-04-07), which back the reference at developer.paypal.com, and from the
authentication guide.

| File                                                   | Source (file › operation › response › example)                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `oauth-token.json`                                     | developer.paypal.com/api/rest/authentication/ › "Sample response"                                          |
| `orders-create.json`                                   | `checkout_orders_v2.json` › `orders.create` › 201 › `orders_create_simple`                                 |
| `orders-create-400-invalid-request.json`               | `checkout_orders_v2.json` › `orders.create` › 400 › `create_400_bad_request`                               |
| `orders-get.json`                                      | `checkout_orders_v2.json` › `orders.get` › 200 › `00_orders_get`                                           |
| `orders-get-404-not-found.json`                        | `checkout_orders_v2.json` › `x-samples.orders.get[1]` (404 Order Not Found)                                |
| `orders-capture.json`                                  | `checkout_orders_v2.json` › `orders.capture` › 201 › `00_orders_capture`                                   |
| `orders-capture-422-payer-action-required.json`        | `checkout_orders_v2.json` › `x-samples.orders.capture[5]` (422 Payer Action Required)                      |
| `orders-capture-422-action-does-not-match-intent.json` | `checkout_orders_v2.json` › `orders.capture` › 422 › `capture_422_unprocessable_entity`                    |
| `orders-authorize.json`                                | `checkout_orders_v2.json` › `orders.authorize` › 201 › `00_orders_authorize`                               |
| `orders-authorize-422-payment-denied.json`             | `checkout_orders_v2.json` › `orders.authorize` › 422 › `authorize_422_unprocessable_entity_payment_denied` |
| `authorizations-capture.json`                          | `payments_payment_v2.json` › `authorizations.capture` › 201 › `authorizations_capture_with_prefer_header`  |
| `authorizations-capture-422-expired.json`              | `payments_payment_v2.json` › `authorizations.capture` › 422 › `authorizations_capture_422_expired`         |
| `authorizations-void.json`                             | `payments_payment_v2.json` › `authorizations.void` › 200 › `authorizations_void_200_idempotent_response`   |
| `authorizations-void-422-previously-captured.json`     | `payments_payment_v2.json` › `authorizations.void` › 422 › `authorizations_void_422_already_captured`      |
| `captures-refund.json`                                 | `payments_payment_v2.json` › `captures.refund` › 201 › `captures_refund_with_prefer_header`                |
| `captures-refund-full.json`                            | `payments_payment_v2.json` › `captures.refund` › 201 › `captures_refund_empty_request`                     |
| `captures-refund-200-idempotent.json`                  | `payments_payment_v2.json` › `captures.refund` › 200 › `captures_refund_200_idempotent_response`           |
| `captures-refund-409-in-progress.json`                 | `payments_payment_v2.json` › `captures.refund` › 409 › `captures_refund_409_conflict`                      |
| `captures-refund-422-amount-exceeded.json`             | `payments_payment_v2.json` › `captures.refund` › 422 › `captures_refund_422_amount_exceeded`               |
| `verify-webhook-signature-request.json`                | `notifications_webhooks_v1.json` › `verify-webhook-signature.post` › request › `verify_webhook_signature`  |

Where the reference has no example, the tests say what they build and from what:

- `ORDER_NOT_APPROVED`, `INSTRUMENT_DECLINED` and `ORDER_ALREADY_CAPTURED` are documented in the
  Orders v2 errors (developer.paypal.com/api/rest/reference/orders/v2/errors/) without a body: the
  422 example above is reused with its issue replaced.
- The answer of `verify-webhook-signature` has only a schema (`verification_status`, `SUCCESS` or
  `FAILURE`), and the reference has no v2 event example: the tests use the envelope of the
  example event above around a `checkout-order` or `refund` resource.

Two examples spell the error name `UNPROCCESSABLE_ENTITY`; they are kept as PayPal wrote them.
