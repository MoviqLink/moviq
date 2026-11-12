# Paying an alternative

- `flow.ts`: creating the order on our server, the buyer's approval in PayPal's window, and our
  server's confirmation. While any step is in flight, or the result is unknown, a new press does
  nothing, so one press is one order. Only `captured` means paid; cancelling, an error, an order
  that is not ours or any other status says that nothing changed or that the server has not
  confirmed yet. An unconfirmed payment is asked about again with `GET /api/payments/orders/:id`
  after 5, 15 and 45 s, then the person can check again; nothing on screen loops meanwhile.
- `paypal.ts`: loads PayPal's web SDK v6 once per client id and gives the flow a one-time
  payment session.
- `useCheckout.ts`: asks the server whether payments are available and why not.
- `PayPalButton.tsx`: PayPal's official `<paypal-button>`, disabled while a step is in flight.
- `PayWithPayPal.tsx`: the price set by the server, the button and each step in words.
