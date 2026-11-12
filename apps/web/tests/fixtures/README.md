# Test fixtures

Answers of the control room API, built from the contracts in `@moviq/contracts` for a given
instant so that ages, next runs and gaps are consistent. They exist only for tests and the visual
review; the product never reads them and never shows invented data.

`sources.ts` describes nine sources, one or more in each state, as offsets from that instant;
`ops.ts` builds every answer from them, with every job state and a viewer and an admin session. The
`fixtures.test.ts` suite checks each answer against its schema, so they stay valid when the
contracts change.

The traveller's fixtures describe one scene, from East Harlem to LaGuardia Terminal B, as offsets
from `now`: `geography.ts` (places and paths), `itineraries.ts` (legs with their provenance) and
`journeys.ts` (Sara's turns, the plan, a journey on track and one at risk with its incident and
alternatives, with or without the server's projected arrival, the journey once the free Q70
alternative is taken, and the payment answers). `journey-fixtures.test.ts` checks them against the
contracts in both languages. `city.ts` is a turn of Sara about the city (an alert on the A, and an
elevators feed that cannot be read), checked in `city-answer.test.ts`.
