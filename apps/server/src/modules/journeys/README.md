# Journeys

Plans a trip backwards from the time the traveller must arrive, keeps the journey, and watches it
live in the worker, whatever browser tabs are open.

| File                      | Responsibility                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ports.ts`                | What journeys need from outside: routing, geocoding, flights, public fares, and the planner itself                                               |
| `planner.ts`              | Backward planning: only itineraries the routing engine returned; the latest departure that keeps the spare time is recommended                   |
| `itineraries.ts`          | An itinerary as MovIQ serves it, each leg with how its times are known and their provenance                                                      |
| `journey-store.ts`        | Plans (kept 30 min, so journeys start from a plan id, never from client data) and journeys, as JSON validated on read, with a version per change |
| `routes.ts`               | `POST /api/plan`, `POST /api/journeys`, `GET`/`DELETE /api/journeys/:id`, and `GET /api/journeys/:id/events` (Server-Sent Events)                |
| `watch-assess.ts`         | Compares a journey with live predictions and alerts: on track, at risk, late or unknown, each with its evidence                                  |
| `watch.ts`                | The leader's watch loop: reads live sources once a round, keeps them fast, writes only what changed                                              |
| `flight-deadline.ts`      | The departure to plan from (revised, else scheduled) and the deadline 120 min before it                                                          |
| `flight-callsign.ts`      | The ICAO call sign of a flight, to find its aircraft in ADS-B                                                                                    |
| `flight-facts.ts`         | What the watch reads for flights (AeroDataBox, FAA, ADS-B) as facts, each with its provenance                                                    |
| `flight-triangulation.ts` | The departure used, where it comes from and where the sources disagree; none without a source                                                    |
| `flight-words.ts`         | The sentences of the flight's proof, with New York times                                                                                         |
| `flight-incidents.ts`     | Time change, gate change, taxiing or airborne, disagreements, FAA programmes, sources down                                                       |
| `flight-watch.ts`         | One round for a journey's flight: the check, its incidents and the new deadline                                                                  |
| `watch-match.ts`          | The live trip that is the planned ride (boarding stop, platform direction) and the alerts of its agency                                          |
| `step-free-lists.ts`      | The five MTA step-free lists (outages, stations, elevators, inventory, entrances), usable or named as down                                       |
| `accessibility.ts`        | The step-free check of an itinerary: each platform boarded or left, the time of the outages, what is not verified                                |
| `watch-elevators.ts`      | Elevators on the platforms still to use: `elevator` and `source-down` incidents, a broken step-free route, the reason of a refusal               |
| `alternatives.ts`         | Other ways from where the plan says the traveller will be, the earliest first; the demo partner taxi among them                                  |
| `taxi-fare.ts`            | The demo partner's upfront taxi price, at the official NYC TLC yellow taxi rates (source cited in the file)                                      |
| `purchases.ts`            | What journeys sell through payments: a paid alternative, switched to only after PayPal confirms, and only if still watched in that transaction   |
| `explanation.ts`          | What Sara's words on a journey are about (verdict, incidents, options), and whether they still apply                                             |

Walks are served with how they are known (`leg.walk`). An itinerary with an estimated walk is
`provisional` (`walking`): the plan says its changes are not confirmed and its spare time is
approximate, and so do the alternatives' reasons and Sara's facts. On a step-free trip a walk
not walked with the wheelchair profile is `walk-unverified` in the step-free check, and the
itineraries and alternatives whose walks were all walked so come first. An itinerary with a walk the
streets have no way for is never served, not even provisional: when none is left, the plan says
that no route can be walked on the streets (`no-street-way`), and no alternative is offered.

A source that cannot be read makes a journey `unknown`, never `on track`. Rides more than 45
minutes away are followed by their timetable, since live predictions start closer to departure.

A journey planned around a flight is checked every round: AeroDataBox (through its cache), the
boarding pass, the FAA's airport status and the aircraft in ADS-B. When the departure moves, the
deadline moves with it (`request.arriveBy`; the planned flight stays as it was) and the journey is
assessed and replanned against it at once. Once the aircraft taxis or takes off, the deadline stays.
Platforms are compared with their direction, and a ride not started yet only matches a live trip
that stops where it begins near the planned time; alerts count only for the agency of the leg.

A step-free plan carries `accessibility` on each itinerary (`planner.ts`, with the platform
reader): for each platform where a ride is boarded or left, `accessible`, `one-direction`,
`elevator-out`, `not-step-free` or `unknown` with its cause, from the MTA station list and the
elevators out or not working during the trip (`engine/step-free.ts`); when the outages were read
(`checkedAt`); and the warnings: modes left out (buses), changes the MTA does not publish inside
stations, and walks measured to a station whose accessible entrance the 2024 survey does not
list. Without a usable list every platform is `unknown`, never `accessible`. Itineraries kept
before 11/11/2026 have none.

Each round the watch reads the same lists once and crosses the platforms a journey has still to
use with the elevators out now or announced before its deadline. Every journey gets `elevator`
incidents with the MTA code, what it serves and the MTA's times (a warning when it is not
step-free). A step-free journey also gets its `accessibility` again; a platform out, without
step-free access or not confirmed makes it `at-risk` and looks for step-free alternatives, each
with its own check; a list that cannot be read is a `source-down` and an `on-track` journey turns
`unknown`. When the routing engine refuses the alternatives with `no-step-free-data`, the watch
keeps why in `watch.stepFreeRefusal`.

Sara's words on the latest change (`watch.explanation`, written by `assistant/journey/`) stay
through a round only while the verdict, the incidents and the options they explain are still the
journey's. A round whose write loses to another (Sara's words, a payment) looks for alternatives
again in the next round.
