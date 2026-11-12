# MovIQ

**Your AI urban assistant. Move smarter.**

MovIQ is an assistant for getting around New York. You tell Sara, the assistant, where you are
going and when you must be there, in plain English or Spanish. Sara plans the trip backwards from
that time with MovIQ's own routing engine, watches the lines and streets of the trip live, and
buys the tickets for it herself with PayPal. Every figure on screen carries its source and its age.

## A two-minute walk-through

1. Open the app and choose **Traveller** on the entry screen.
2. Open **Agent** from the menu.
3. Ask for a trip, for example "I need to be at the Brooklyn Museum tomorrow at 10:00 am, leaving
   from Times Square". Sara answers with the itinerary and its latest safe departure, and shows
   the trip's roadmap as a timeline. When a place has several matches, she offers them as buttons.
4. Choose **Buy the tickets for this trip**. With **Let Sara buy tickets for me** switched on,
   Sara pays from the trip wallet or charges the PayPal billing agreement, with no PayPal window.
5. View or download each pass under her answer, or in the dashboard's **My tickets** tab.
   Then say "Change of plans: take me to Yankee Stadium instead, same time" to see her plan the
   trip again, and "Watch the 7 line for me" to start a watch (it appears under **Sara watches
   for you**, where watches can also be added by hand).
6. Open **Dashboard**: **Overview** shows the figures at a glance and the wallet; **Wallet** adds
   funds with PayPal; **Payments** and **Refunds** list every operation.
7. Return to the entry screen, choose **Business** and see the same purchase as a sale in the
   **Transit ticket provider** dashboard.

## How PayPal is used

Everything runs in the PayPal sandbox and through the server only. The server sets every price;
the client sends only what is being bought.

| What it does                                   | PayPal API                                                        | Where in the code                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Pays a ticket or a top-up with buyer approval  | Orders v2 (`/v2/checkout/orders`), intent `CAPTURE`, then capture | `apps/server/src/modules/payments/`                     |
| Lets the assistant pay without a PayPal window | Billing agreements (`/v1/billing-agreements`), approved once      | `apps/server/src/modules/payments/paypal/agreements.ts` |
| Buys the tickets of a trip for the traveller   | Orders v2 charged to the agreement, or paid from the wallet       | `apps/server/src/modules/tickets/autopay.ts`            |
| Keeps a prepaid trip wallet                    | Top-ups paid with PayPal; tickets paid from the balance           | `apps/server/src/modules/wallet/`                       |
| Refunds a payment                              | Payments v2 capture refunds (`/v2/payments/captures/{id}/refund`) | `apps/server/src/modules/payments/steps.ts`             |
| Settles payments whose answer was lost         | Webhooks with signature verification, and reconciliation          | `payments/webhooks.ts`, `payments/reconcile.ts`         |

- **Idempotency.** Every call that moves money carries a stable `PayPal-Request-Id`, so a retry
  never charges twice.
- **Own ledger.** Each payment is recorded before PayPal is called. Its allowed status changes are
  listed in `transitions.ts` and enforced by a database trigger. A lost answer leaves the payment
  `unknown`, never paid and never failed, until reconciliation reads PayPal's own record.
- **Nothing before confirmation.** A ticket or a top-up is applied only once PayPal confirms the
  capture, in the same transaction; if it cannot be applied, the capture is refunded in full.
- **The traveller decides.** The assistant buys only while the traveller's **Let Sara buy tickets
  for me** switch is on, within a spending limit per request set by the server.
- **Privacy.** PayPal receives the amount, a description and the payment id; no journey or
  traveller data. The payer's name and email returned by PayPal are never stored.
- **Demo mode.** With the optional `PAYPAL_DEMO_AGREEMENT_ID` (sandbox only), every demo visitor
  starts connected to the sandbox test buyer's agreement, with no sign-in.

Every ticket bought by a traveller or by their assistant appears as a sale in the dashboard of the
fictional **Transit ticket provider** (the **Business** entry), with the same purchase and PayPal
references.

Details: [payments module](apps/server/src/modules/payments/README.md).

## AG Grid and Bryntum

- **AG Grid Community** (`ag-grid-community`, `ag-grid-react`), through the shared
  `apps/web/src/shared/ui/DataGrid.tsx`: the traveller's payments, refunds, tickets and trip
  history; the provider's sales and product catalogue; and the control room (`#/ops`) with its
  sources, jobs, audit and money in doubt.
- **Bryntum Gantt** (community edition, MIT): the trip roadmap, each leg of the itinerary as a bar
  on a timeline (`apps/web/src/features/roadmap/`), shown on the trip card of the Agent screen and
  in the Calendar.

## Live data and its honesty

The city layer shows subway, buses, PATH, commuter rail, ferries and shuttles with their position
and how that position is known; traffic (incidents, closures, cameras); transit incidents; and
stations and lines. The sources are collected and validated by the worker
(`apps/server/src/modules/data-platform/`) and served by `live/` and `city-layers/`.

The rule of the product is **what is shown is followed**: every value carries its source and its
age. A source that is down is shown as unavailable, never read as "no incidents", and what is
estimated is labelled as estimated. Every source and its licence are listed in
[data sources](docs/data-sources.md) and on the app's credits page.

## How AI is used

Sara is a language model with tools (`apps/server/src/modules/assistant/`): finding places and
flights, setting the arrival time, planning the trip, answering about the city (lines, incidents,
vehicles, stations) and buying tickets. Tool calls and answers are validated against schemas, and
a reply that states a time no source gave is replaced by a fixed reply. Personal data is stripped
before a message leaves the server, and a shared daily token budget caps use. Without a model key,
or when the budget is spent, Sara runs in a deterministic basic mode and says so.

## Architecture

| Path                 | What it holds                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | The `api` and `worker` processes (Node.js, one codebase)                                                                         |
| `apps/web`           | The web app (React, Vite, MapLibre), in English and Spanish                                                                      |
| `apps/recorder-cf`   | The 24-hour recorder of live sources on Cloudflare Workers                                                                       |
| `packages/contracts` | Boundary schemas (Zod) shared by server and web                                                                                  |
| `tools`              | Delivery checks: licences, data-source documentation and repository hygiene                                                      |
| `tests`              | Fixtures and end-to-end walk-throughs (Playwright)                                                                               |
| `docs`               | [Architecture](docs/architecture.md), [operations](docs/operations.md), [security](docs/security.md), [testing](docs/testing.md) |

Main server modules (`apps/server/src/modules/`): `assistant` (Sara), `journeys` (backward
planning, the routing engine with a fallback, the live watch), `payments` (PayPal and the ledger),
`tickets` (catalogue, purchases, the assistant's payments, the provider's sales), `wallet` (the
trip wallet), `data-platform`, `live` and `city-layers` (the city live), `identity` (sessions) and
`operations` (health and the control room). See [apps](apps/README.md).

## Getting started

Requires Node.js 24.11 or later.

```sh
npm install
cp .env.example .env    # then fill in the variables below
npm run build
npm start               # API and web on http://127.0.0.1:8080
npm run start:worker    # in a second terminal: data collection, trip watch, reconciliation
```

Open <http://127.0.0.1:8080> and choose **Traveller** or **Business**.

| Variable                                                         | Purpose                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`                       | A PayPal sandbox app; without them payments report as unavailable         |
| `PAYPAL_ENV`                                                     | Keep `sandbox`                                                            |
| `TICKET_DEMO_ENABLED`                                            | `true` enables the Traveller and Business entry (requires PayPal sandbox) |
| `PAYPAL_DEMO_AGREEMENT_ID`                                       | Optional: a sandbox billing agreement every demo visitor starts with      |
| `PAYPAL_WEBHOOK_ID`                                              | Optional: enables webhooks; without it, reconciliation alone settles      |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `ASSISTANT_DAILY_TOKEN_BUDGET` | Optional: Sara's language model and its daily token budget                |

Every other variable is optional and described in `.env.example` and in
[operations](docs/operations.md). Without credentials the server still starts, collects the open
data sources and reports which integrations are missing.

For development: `npm run dev`, `npm run dev:worker` and `npm run dev:web` (web on
<http://127.0.0.1:5190>, proxying `/api`).

## Tests and quality

| Command                   | What it runs                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| `npm run verify`          | The full gate: every check below except the live and sandbox ones        |
| `npm run format:check`    | Prettier                                                                 |
| `npm run lint`            | ESLint, zero warnings                                                    |
| `npm run typecheck`       | TypeScript across server, web, recorder, tools and tests                 |
| `npm test`                | Unit and integration tests (Vitest), with no network and no keys         |
| `npm run e2e`             | End-to-end walk-throughs in a browser (Playwright)                       |
| `npm run check:unused`    | Unused code and dependencies (Knip)                                      |
| `npm run check:licenses`  | Third-party licences                                                     |
| `npm run check:docs`      | That the data-source documentation matches the code                      |
| `npm run check:delivery`  | Repository hygiene                                                       |
| `npm run verify:live`     | Every source and integration against the real providers                  |
| `npm run e2e:paypal`      | A payment in the PayPal sandbox with a real buyer approval               |
| `npm run e2e:ticket-demo` | Demo sign-in and a real sandbox ticket capture in an isolated deployment |

## Declared limits

- PayPal runs in the sandbox: no real money moves. Tickets are demonstrations at the published
  fare and do not entitle anyone to travel.
- The **Transit ticket provider** is fictional.
- The trip history in the dashboard (**My trips**, **Calendar**) is sample data, and the screen
  says so ("Sample history"). Trips started in the browser are shown as they are.

## Licence

MIT, see [LICENSE](LICENSE). Third-party packages are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
