# Ticket demonstrations

The catalogue contains reference fares for sandbox purchases; it issues no travel entitlement.
Wallet receipts belong to the anonymous traveller and only appear after confirmed capture.

Set `TICKET_DEMO_ENABLED=true` and configure PayPal Sandbox to enable `/demo/status`,
`POST /demo/traveller`, `POST /demo/partner`, `POST /demo/logout` and `GET /demo/partner`.
The status endpoint is always available. The partner session is independent of merchant sessions
and represents one fictional transport provider responsible for these demonstration products.
Its latest 100 sales contain no buyer data; completed refunds reduce net revenue. Logout removes
only the partner session. The former global merchant summary is no longer available.

## Tickets the assistant buys

`autopay.ts` lets Sara buy tickets with no PayPal window, in the sandbox only. The traveller's
switch (`PUT /autopay`, on by default) and the PayPal billing agreement live in `ticket_autopay`.
`POST /autopay` opens the approval in PayPal, which returns the browser to `GET /autopay/return`
(or `/autopay/cancelled`); `DELETE /autopay` cancels the agreement in PayPal first and then
forgets it. Without an agreement of their own, travellers use the sandbox test buyer's
(`PAYPAL_DEMO_AGREEMENT_ID`) while `TICKET_DEMO_ENABLED=true`.

Each ticket is paid from the trip wallet (`../wallet/`) when its balance covers it; otherwise
its order is charged to the agreement, read back from PayPal and applied only once captured. One
request buys at most 8 tickets or $60. `addFunds` tops up the trip wallet with the connected
PayPal; the top-up counts only once captured.
