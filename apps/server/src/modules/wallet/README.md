# Trip wallet

The traveller's prepaid balance. Money is added with PayPal: `POST /top-ups` records the amount,
its `purpose` is paid like any other payment, and the top-up counts once PayPal confirms the
capture (`walletTopUps` is its `PurchaseCatalog`). `payFromWallet` pays a purchase from the
balance in one transaction: the payment is written to the common ledger as captured, with no
PayPal order, and the spend is recorded. The balance is always computed from captured payments.

| File           | Responsibility                                             |
| -------------- | ---------------------------------------------------------- |
| `store.ts`     | Top-ups, the wallet as read, and paying from the balance   |
| `purchases.ts` | Pricing and applying a top-up once its payment is captured |
| `routes.ts`    | `GET /api/wallet` and `POST /api/wallet/top-ups`           |
