# Rewards: reserving with PayPal

- `flow.ts`: the steps of a reservation. The server opens the PayPal order, the buyer approves it
  in PayPal's window, and the server confirms the hold and creates the order. One press is one
  order, and only the order the server returns counts as reserved.
- `ReserveWithPayPal.tsx`: PayPal's official button (from `trip/payment/`) on that flow. Closing
  PayPal, a refusal (409, with the server's sentence and what to do) or PayPal down (503) says that
  nothing was held.

Tested in `apps/web/tests/rewards.test.ts`, with a double of PayPal's SDK.
