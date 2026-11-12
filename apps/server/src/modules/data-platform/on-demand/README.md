# On-demand providers

Providers asked at the moment journeys need them, behind the interfaces of
`modules/journeys/ports.ts`. Each one validates the answer with a schema, returns a value with its
provenance or a failure with its state and code, and never makes up a time, a stop or a place.
All requests go through the shared HTTP client with the generic browser identity.

| File                             | Responsibility                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `transitous.ts`                  | `RoutingProvider` over Transitous (MOTIS 2), its daily budget and its attribution   |
| `transitous-request.ts`          | The "arrive by" plan request: modes, walk limit, step-free footpaths                |
| `transitous-response.ts`         | The answer's schema and its legs as `RoutedLeg`, left out whole when unusable       |
| `transitous-ids.ts`              | Feed and GTFS id of a Transitous stop or route id                                   |
| `transitous-walk.ts`             | One walk on the streets: `plan` with no transit, walking direct, foot or wheelchair |
| `transitous-streets.ts`          | `StreetWalks` for the engine: answers kept 12 h, 4 at once, a pause after a failure |
| `geosearch.ts`                   | `Geocoder` over NYC GeoSearch: New York addresses, best first, each point once      |
| `aerodatabox-gateway.ts`         | AeroDataBox (RapidAPI) for the process: one request a second, within the units      |
| `aerodatabox.ts`                 | `FlightFinder` over the gateway: Flight Status (single day)                         |
| `aerodatabox-answer.ts`          | Its answer: scheduled, revised or predicted, take-off, terminal, gate, call sign    |
| `aerodatabox-units.ts`           | The free plan's 400 units a month: 2 per request, 40 kept back, gateway's count     |
| `flight-cache.ts`                | Each flight's answer kept 3 hours far from departure, 20 minutes in the last three  |
| `aerodatabox-fids.ts`            | The FIDS of one airport: departures and arrivals of 12 hours in one request         |
| `airport-boards.ts`              | `createAirportBoards`: each airport's board, asked when due, kept with its time     |
| `board-budget.ts`                | The boards' share of the units: 100 kept for flights, the rest spread by day        |
| `outcome.ts`                     | Failures of a request or a body as outcomes, and the provenance of an answer        |
| `polyline.ts`, `daily-budget.ts` | Encoded polylines, and a count of requests per UTC day                              |
| `index.ts`                       | `createOnDemandProviders`: the providers and the boards, on one AeroDataBox count   |

Codes shared by all: `timeout`, `cancelled`, `network`, `too-large`, `rate-limited`,
`access-refused`, `request-refused`, `provider-error`, `not-json` and `unexpected-shape`. Their
own: `no-itineraries` and `daily-budget` (Transitous), `empty-text` and `no-match` (GeoSearch),
`missing-credential`, `bad-query`, `no-departure-time` and `monthly-units` (AeroDataBox). Without
`AERODATABOX_KEY`, flights and boards answer `missing-credential` without sending any request.

## AeroDataBox's free plan

400 API units a month, one request a second, non-commercial use and attribution (the web credits
AeroDataBox wherever its data is shown). Flight Status is Tier 2: 2 units a request
(aerodatabox.com/pricing; the gateway answers `x-tier: Tier 2`), and a flight plan is never asked,
since it may bill twice. MovIQ spends at most 360: 40 are kept back. The process counts its own
spending over 31 days and, after each answer, trusts `x-ratelimit-api-units-remaining` and
`-reset`, which every process using the key shares; a restart sends at most one request before the
gateway's count is known again. With no units left the answer is `monthly-units` (`rate_limited`),
nothing is sent, and Sara asks for the time on the boarding pass. Answers are kept per flight
(`flight-cache.ts`, failures 5 minutes), so only Sara's searches and watched journeys spend units.

Airport boards (FIDS, Tier 2, 2 units for one airport's 12 hours both ways) share the gateway and
its count with flights: one request a second for both, and one count of units. A board is asked
only when someone reads it, at most every 3 hours per airport, never below the 100 units kept
for travellers' flights, and within its daily share of what is left until the month renews (or
until the end of the competition's evaluation, 15/12/2026, when that comes first). Without units
or with the provider down (asked again after 15 minutes), the last board is served as `kept`
with its time; past 7 days, AeroDataBox's limit, it is dropped. The accounts are in
`modules/airports/README.md`.

## Walks on the streets

The engine asks Transitous for the walks of its final itineraries (`journeys/engine/README.md`).
MOTIS 2 has two street calls: `one-to-many` gives durations only and no wheelchair profile, so
each walk is a `plan` with `transitModes` empty (no transit), `directModes=WALK`,
`pedestrianProfile` `FOOT` or `WHEELCHAIR` and `maxDirectTime` 3600 s, answered in `direct`
with its seconds, metres and polyline (0.41 to 0.46 s on 11/11/2026). Corners are rounded to 4
decimals and each answer, a walk or no way, is kept 12 hours by corners and profile (at most
5,000). Each plan sends at most 8, four at once, each waited 4 s; after a failure none is sent for
2 minutes. Plans and walks share one count of Transitous requests per process and UTC day (300,
under Transitous' 720 a day for `/plan` with the API and the worker); walks stop while 100 or
fewer are left, so trips the engine cannot plan still reach Transitous. A walk not answered stays
estimated. A walk leg of a Transitous plan is `street` when it has its path; a change it gives
with none (120 s between platforms, no distance) is `estimated`, `not-asked`: it was never asked
of the streets.

Transitous ids are kept as Transitous gives them (`us-ny-MTA-NYCSubway_A41N`), so the operator
stays known; `splitTransitousId` gives the GTFS id. Transitous' `wheelchairAccessible` is not read:
on 11/11/2026 it said `NOT_ACCESSIBLE` for every MTA bus and subway leg.

Tested in `apps/server/tests/on-demand/` against `tests/fixtures/on-demand/`, and against the
real services in `apps/server/tests/live/on-demand.live.test.ts` and
`street-walk.live.test.ts`.
