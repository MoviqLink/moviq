# Money in doubt

`#/ops/money`: every amount MovIQ has not settled with PayPal, as `GET /api/ops/money` lists it.
`MoneyView` loads it with the rest of the room; `MoneyBody` draws the totals (open, escalated,
amount) with the escalation rule the server sent, then the grid, escalated first, or says that
nothing is in doubt. `columns.tsx` holds the grid's columns and cells, `texts.ts` the words in
English and Spanish.
