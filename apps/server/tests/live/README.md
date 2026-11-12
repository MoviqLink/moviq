# Live tests

`npm run verify:live` sends one real request to each source of the catalogue and runs the whole
admission chain on the answer. It needs network access and the credentials of the integrations
(read from the environment, as `.env` does for the servers). It is not part of `npm run verify`,
which runs without keys; an integration counts as done only once its live test passes.

| File                        | Sends                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `sources.live.test.ts`      | One request per source of the catalogue                                                   |
| `on-demand.live.test.ts`    | One route, one address search and, with its key, one flight                               |
| `openai.live.test.ts`       | One turn to the model, with `OPENAI_API_KEY`                                              |
| `sara-trip.live.test.ts`    | One explanation of a trip at risk, in Spanish, with `OPENAI_API_KEY`                      |
| `paypal.live.test.ts`       | A sandbox order, with the PayPal sandbox credentials                                      |
| `paypal-holds.live.test.ts` | A sandbox hold (authorize intent, MovIQ's brand and lines) and a sandbox payout of US$1   |
| `city-sources.live.test.ts` | One request per source of LIRR, Metro-North, PATH, ferries, Citi Bike, ADS-B and AIS      |
| `engine.live.test.ts`       | One subway timetable, one live feed and one Transitous plan, compared with the own engine |
| `street-walk.live.test.ts`  | One walk on the streets of Transitous, Times Square to Bryant Park                        |
| `events.live.test.ts`       | Ticketmaster's first window (with its key), NYC Parks and the two venue pages             |

Without a credential, its test fails and says which variable to set; it never calls the provider.
