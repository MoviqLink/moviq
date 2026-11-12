# Merchant panel

The web of the demo merchants (`#/merchant/…`), on the routes of `/api/merchant`
(`apps/server/src/modules/commerce/merchant-routes.ts`). Every merchant is a demo, marked so, and
is chosen after entering the private demo access key; the server keeps the session in an
`HttpOnly`, `SameSite=Strict` cookie. The key stays only in the sign-in component until success,
never in browser storage. The panel is not in the
traveller's navigation.

| Screen     | Address                      | What it shows                                                                             | Requirements     |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| Sign-in    | `#/merchant` without session | The demo merchants with their stop and buses                                              | F-J9-01          |
| Today      | `#/merchant`                 | What was charged, orders, offers, reserved share, average reward; pickups on the line     | F-J9-02          |
| Requests   | `#/merchant/requests[/<id>]` | Each need, its offer, and the conversation between Sara and the agent, message by message | F-J9-03, F-J9-13 |
| Tickets    | `#/merchant/tickets`         | Today's tickets in AG Grid; start and ready (collecting is by scanning)                   | F-J9-04          |
| Scan       | `#/merchant/scan`            | The pickup code by camera (`BarcodeDetector`) or pasted; refunds of missing lines         | F-J9-05          |
| Customers  | `#/merchant/customers`       | Aliases and the preferences that matter for the menu, nothing else                        | F-J9-06          |
| Payouts    | `#/merchant/payouts`         | The last payout, the account (fixed for a demo: 403), "get paid now", batches in AG Grid  | F-J9-07          |
| Your agent | `#/merchant/agent`           | Rules and opening hours, the talk with the agent, a preview of its offers, the kitchen    | F-J9-08, 09, 14  |

## Rules

- Every amount comes from the server in minor units and is only formatted here; nothing is added
  up or discounted in the web.
- Every answer is validated before it is shown, against the schemas of `/api/merchant` in
  `@moviq/contracts` (`merchant.ts`, `merchant-talk.ts`), the ones the server builds its answers
  with. An answer outside them is a problem, never shown. A refused scan is an answer: its code
  is said in English and Spanish with what to do.
- A problem says what happened and what to do (`model/problem.ts`), with the server's reference.
  The server's own sentences (a refusal's detail, an agent's question) are English and are marked
  `lang="en"`.
- English and Spanish carry the same keys. Nothing moves in a loop: a screen asks again every 15 s
  while visible and changes its numbers once per answer.

## Files

- `MerchantApp.tsx`: the session gate; `routes.ts`, `session.ts`: addresses and the open session.
- `api.ts`, `schemas.ts`: the endpoints, through the shared client, and the types of their
  answers.
- `useResource.ts`, `useAction.ts`: loading a screen's data, and one request the merchant makes.
- `model/`: pure rules: the conversation as steps, the counter, customers' tags, the rules form
  and problems. `ui/` the pieces, `views/` the screens.
- `texts.ts` with `texts-*`, `talk-*`, `desk-*` and `agent-*`: the words, in English and Spanish.
- `merchant.css`, `screens.css`, `talk.css`, `counter.css`: the frame and the screens.

Tested in `apps/web/tests/merchant/` (models, API, views, texts, "Your agent" and its talk) and end to end in
`tests/e2e/merchant.spec.ts`.
