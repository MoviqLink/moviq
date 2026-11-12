# Commerce test support

`commerce.ts`: a migrated database with the demo merchants, PayPal in memory, both APIs mounted
(`/api/commerce`, `/api/merchant`), a browser that keeps its cookies (and can follow a restarted
server), the evening clock and a traveller's tastes. `orders.ts`: Payouts in memory, a merchant
session and an order reserved, approved and collected. `processes.ts`: the API and the worker run
from source as child processes, stopped by a signal, and a browser on their port that keeps its
cookies.
