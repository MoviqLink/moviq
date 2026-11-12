# Payouts

What MovIQ pays each merchant, with PayPal Payouts (`/v1/payments/payouts`). A batch and its
items are written first, in one transaction, so two calls at once never pay the same sale: an
item key is in at most one live batch (unique index on `payout_items`). The batch id is PayPal's
`sender_batch_id` and the `PayPal-Request-Id`, which PayPal refuses to pay twice. A batch PayPal
denies, cancels or refuses frees its items, which become payable again.

The merchant bears refunds. A refund PayPal confirmed is an item of its own (`kind = 'refund'`,
key `refund:<hold>:<operation>`), deducted once: in the batch that pays its sale, or, when the
sale was already paid, in the next batches. Until then it is a balance the merchant owes
(`refundsToDeduct`), kept across batches that pay nothing or are denied, and a batch never pays
zero or less. A sale with a refund PayPal has not confirmed waits for it.

| File               | Responsibility                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `payout-run.ts`    | `payMerchant`, `refundsToDeduct` (sales and refunds from the selling module) and `refreshBatch` |
| `payout-ledger.ts` | `payout_batches` and `payout_items`                                                             |
| `payouts-setup.ts` | The Payouts client from the PayPal credentials                                                  |

Tested in `tests/payments/paypal-presentation.test.ts` (the official examples) and
`tests/commerce/merchant.test.ts` (once, concurrently, denied) and `tests/commerce/money.test.ts`
(refunds before, during and after a payout).
