# Assistant tests

| File                        | Covers                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `reader.test.ts`            | The basic reader in English and Spanish: places, New York times, flight numbers                                      |
| `turns.test.ts`             | Whole turns over HTTP in basic mode, conversations, ownership and expiry                                             |
| `ai-mode.test.ts`           | Turns with a model double: tools, rejected calls, budget, privacy                                                    |
| `openai.test.ts`            | The OpenAI adapter against a local server answering with the reference examples                                      |
| `guards.test.ts`            | Personal data, strict tool schemas and the daily budget under concurrency                                            |
| `boarding-pass.test.ts`     | The boarding pass when AeroDataBox cannot give the flight, both modes, EN/ES; places offered                         |
| `doubles.ts`                | Doubles of the geocoder, the flight finder, the planner and the model                                                |
| `city-turns.test.ts`        | City questions in basic mode, EN/ES: lines, incidents, ferries, PATH, vehicles, statistics                           |
| `city-stations.test.ts`     | Elevators, escalators and step-free access; outages announced; feeds down                                            |
| `city-ai.test.ts`           | City tools with the model double: figures checked, unknown lines, sources down; the trip                             |
| `city-restrooms.test.ts`    | Restrooms near the trip, a station or a place: both modes, EN/ES, list down, hours and metres checked                |
| `city-reader.test.ts`       | The basic reader of city questions in English and Spanish, and what it leaves to planning                            |
| `city-doubles.ts`           | A reader serving hand-written copies through each source's schema, and Explore's city                                |
| `city-data.ts`              | The hand-written copies: MTA alerts, subway feeds, stations, outages, PATH, ferries, recorder                        |
| `harness.ts`                | The assistant mounted under `/api`, and a device that keeps its session                                              |
| `trip-explanation.test.ts`  | Sara's words on a trip change: facts only, once per change, fixed words, no model or allowance                       |
| `trip-questions.test.ts`    | Questions on a trip; `propose_alternative` and the PayPal order at the server's price                                |
| `trip-doubles.ts`           | A trip at risk with a free option and a priced taxi, owned by a device with a session                                |
| `trip-rewards.test.ts`      | Cravings on a trip: the basic reader, both modes, offers by number, no alias or id to the model                      |
| `sara-rewards-flow.test.ts` | From a message to Sara on the whole app to the need, the question, the offer, the PayPal hold, the code and the scan |

No test calls OpenAI: the real calls are in `tests/live/openai.live.test.ts` and
`tests/live/sara-trip.live.test.ts`.
