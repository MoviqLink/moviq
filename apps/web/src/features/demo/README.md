# Demo entry and dashboards

The entry offers separate traveller and transport-provider demonstration sessions. Availability
and session creation are checked with `/api/tickets/demo`; the progress animation never grants
access by itself. The business session is independent of restaurant merchant access and its logout
does not erase the traveller wallet.

The business dashboard (`#/business`) belongs to the transit ticket provider: every ticket a
traveller, or Sara on their behalf, buys with PayPal Sandbox appears there as a sale. It shows the
server totals (sales, gross, refunded, net) as one line of figures, the sales in an AG Grid newest
first (date, product, operator, amount, status, PayPal capture, payment) and the offered catalog in
a second grid. Totals cover all transactions; the grid lists the latest 100. Reads refresh while
visible, on focus, and on request. Failed refreshes retain the last successful data and report that
it may be stale. The catalog links to published reference fares; demo purchases do not issue
transport entitlements.

The entry and sign-in styles are in `login.css`; the business dashboard styles are in `demo.css`.
