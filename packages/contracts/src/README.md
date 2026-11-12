# Contracts sources

| File                | Contract                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `errors.ts`         | The single error body of the API and its codes                                                                 |
| `health.ts`         | `/healthz` (liveness) and `/readyz` (readiness with its checks)                                                |
| `time.ts`           | Instants in UTC (`toInstant` is the only way to write one)                                                     |
| `sources.ts`        | Source states, provenance and runs                                                                             |
| `ops.ts`            | The control room API: sessions, sources, jobs, worker, audit                                                   |
| `money.ts`          | Amounts in minor units with their currency                                                                     |
| `journeys.ts`       | Plans, watched journeys, incidents and alternatives                                                            |
| `legs.ts`           | Places, modes and legs, with how a walk is known (on the streets, a station rule, estimated)                   |
| `accessibility.ts`  | The step-free check of an itinerary: platforms, elevators and what is not verified                             |
| `assistant.ts`      | Sara's turns: what she understood, what is missing, her answer, what she found about the city with its sources |
| `payments.ts`       | Payment configuration, orders and their states                                                                 |
| `live.ts`           | Explore: vehicles, stations, modes and sources live                                                            |
| `airports.ts`       | Airport boards: flights, ADS-B movements, the FAA status and attribution                                       |
| `events.ts`         | Events of New York: venue, times, status, listings and sources                                                 |
| `city-items.ts`     | Explore's city layers: groups, layer ids and what each item is                                                 |
| `city-layers.ts`    | The city layers answer, parking signs and camera picture headers                                               |
| `restrooms.ts`      | Public restrooms: what the city lists of each, and those nearest to a few points                               |
| `recorder.ts`       | The recorder's status for the control room                                                                     |
| `recorder-stats.ts` | The daily statistics the Cloudflare recorder publishes, as compact tuples with their counts                    |
| `merchant.ts`       | The demo merchant's panel: its answers, opening hours, scan refusals and the agent's preview                   |
| `merchant-talk.ts`  | The merchant talking with its agent: the message, the answer and the change it proposes                        |
| `index.ts`          | The public surface of the package                                                                              |

`promotions.ts` defines the demo featured menu items shown along a watched journey.
