# Virtual rides

A traveller boards a real bus with current GPS and timed stops. The last observed position is
kept when feeds fail, labelled lost; no invitations are created on a stale reading. Invitations
are deterministic demo previews near upcoming stops, persisted once and expiring after five
minutes. A deliberate request uses the existing validated merchant-agent protocol.

The traveller chooses an origin and requests a provider-backed feasible plan before a PayPal hold.
The guard is checked again during confirmation and in reconciliation; a stale or unavailable plan
cannot create an order. Once the hold is authorized, the real trip is replanned and started once
under a fenced lease. A failed plan leaves the authorized order available to cancel. Merchant
metrics expose only that merchant's aggregate virtual requests, reservations and trips started.
