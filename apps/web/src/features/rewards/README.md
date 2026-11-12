# Rewards on the way

The traveller tells Sara what they fancy ("a coffee with oat milk", "ramen"); Sara passes it to
the demo merchants the trip passes, each with its own AI agent; the server validates every offer;
the traveller reserves one with PayPal (a hold, charged only when the merchant scans the code) and
collects it with a signed QR. Everything goes through `/api/commerce`; every amount, time and state
on screen is the server's. The merchants are demo ones and say so.

- `RewardsOnTheWay.tsx`: on the trip screen (`trip/TripScreen.tsx`), under Sara's card while the
  trip is watched: the field "Something on the way" and the need Sara opened from her own field
  (`turn.rewards.needId`, read with `GET /needs/:id`).
- `RewardsScreen.tsx`: `#/rewards`, linked from the home page: where to ask (the trips under watch
  in this browser, or planning one), what Sara tells the merchants, and My orders.
- `api.ts`: `POST /needs`, `GET /needs/:id`, `POST /needs/:id/answers`, `POST /offers/:id/decline`,
  `POST /offers/:id/reserve {language}` (gives `paypalOrderId`), `POST /offers/:id/confirm`,
  `GET /orders`, `GET /orders/:id` and `POST /orders/:id/cancel`, each answer validated.
- `useShopper.ts`, `model/shopper.ts`: the alias and tastes, kept on this device only and checked
  against the contract. Sara sends them with the need, and with a question about the trip so she
  can ask the merchants; the server never gives them to the language model.
- `model/need.ts`: the offers, Sara's recommendation first, then the largest reward; a merchant's
  question in the reader's language (the answer goes as the merchant wrote it); why there is no
  offer; the kitchen changes in Spanish; when cancelling is free (the server's word).
- `model/server-words.ts`: the server's refusals (an offer expired or past its pickup, a hold
  being released) in English as written and in Spanish; an unknown one is shown as written.
- `hold/flow.ts`, `hold/ReserveWithPayPal.tsx`: the reservation with PayPal's official button
  (`trip/payment/`): the server opens the order, the buyer approves it in PayPal's window, the
  server confirms the hold and creates the order. One press is one order; only the order from the
  server counts as reserved; closing PayPal, a refusal (409, with the server's sentence and what to
  do) or PayPal down (503) says that nothing was held.
- `qr/qr.ts`, `qr/QrCode.tsx`: a QR encoder (byte mode, level M, versions 1 to 40) and its SVG,
  dark on white in both themes. Checked with macOS's own reader (Vision) on codes of versions 1, 7
  and 13.
- `ui/`: the offer rows on the route line (`OfferRow`), the questions and the offers (`NeedPanel`),
  what Sara tells the merchants (`ShopperForm`), an order with its code, its hold and free
  cancellation (`OrderCard`), and My orders (`MyOrders`).
- `texts.ts`: English and Spanish, with the same keys. `rewards.css`: the styles; nothing moves more
  than once.

Tested in `apps/web/tests/rewards.test.ts` (models, the hold flow with a double of PayPal's SDK,
the server's words, the QR) and `rewards-views.test.ts` (the rows, the question and the order as
rendered), and end to end in `tests/e2e/rewards.spec.ts`.

`ui/PromotionsOnTheWay.tsx` shows demo featured menu items along the watched route; selecting
one requests a checked personal offer through the existing flow.
