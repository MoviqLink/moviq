# Traveller dashboard

The overview reads from top to bottom: Sara's question; "At a glance", three half-circle gauges beside the trip wallet; the recent trips; and the latest tickets.

The gauges (`Gauge.tsx`, geometry and colour bands in `gauge.ts`) show trips on time and trips where Sara re-routed, both counted from the sample history in `../triplog/sample.ts`, and the share of the wallet spent, read from `GET /api/wallet`. The sample notice sits beside every figure that comes from the sample history. The dial is drawn once, with a single entry transition and none under reduced motion.

The wallet card (`Wallet.tsx`) shows the balance, a bar of spent against added, both totals, the latest three movements and the way to add funds with PayPal (sandbox). If the server cannot answer, the card and the gauge say "Unavailable" instead of guessing.

The latest tickets use the AG Grid columns in `columns.ts`. Amounts sort as integer minor units.
