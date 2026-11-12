# Tickets

`#/tickets` shows official fare references, category filters, and the sandbox purchase path;
`#/tickets/wallet` lists only server-confirmed sandbox receipts. The UI uses the server catalogue
and source verification date, creates a server intent before opening PayPal, then reuses the
trip payment flow. A sandbox payment never represents a travel ticket, QR code, balance or
operator affiliation.

`TicketSalesView` lives at `#/merchant/ticket-sales` inside the existing signed-in demo merchant
panel. It shows only aggregate confirmed sales and refunds, with no traveller details.

`SandboxHelp` explains the test-buyer approval flow before the PayPal window opens. When explicitly enabled by the server, it can retrieve and copy the sandbox test-buyer credentials; the password is masked by default.

The help can also open at `#/sandbox-help` in a separate tab; it still requires an explicit action to retrieve the test account.
