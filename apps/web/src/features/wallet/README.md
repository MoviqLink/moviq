# Trip wallet

Three screens of the traveller dashboard, each a `<main id="main">` without its own top bar.

- `WalletScreen` — the balance, what was added with PayPal and what tickets spent, and
  **Add funds**: pick $10, $25, $50, $100 or another whole amount from $5 to $500. The top-up is
  recorded with `POST /api/wallet/top-ups` and its `purpose` is paid exactly like a ticket
  (`/api/payments/orders`, PayPal's approval window, `/confirm`) through `TopUpPayment`. Once
  PayPal confirms the capture, the wallet is read again and the new balance shows.
- `PaymentsScreen` — wallet top-ups and tickets in one AG Grid, with the added, spent and balance
  figures above.
- `RefundsScreen` — refunded tickets with their PayPal order and capture.

Data comes from `api.ts` (`/api/wallet`) and `../tickets/api.ts` (`/api/tickets/wallet`). If an
endpoint fails, the screen says so and offers to try again; nothing else on the page breaks.
PayPal runs in Sandbox: no real money moves.
