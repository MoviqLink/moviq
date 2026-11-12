# Fares

The public fare of an itinerary, only where MovIQ has the rule from the operator itself. The bus
and subway fare is paid with OMNY when boarding; MovIQ shows it and never sells it.

| File            | Responsibility                                                                         |
| --------------- | -------------------------------------------------------------------------------------- |
| `omny.ts`       | `omnyFareRules` and `OMNY_FARE`: $3, one free transfer in two hours, $35 cap in 7 days |
| `omny-rides.ts` | The taps an itinerary needs, or none when a leg has no verified rule                   |

The figures come from https://www.mta.info/fares-tolls/subway-bus, read on 11/11/2026. A leg
without a verified rule makes the whole fare `null`: express buses, the Staten Island Railway, the
Q70 LaGuardia Link, LIRR, Metro-North, PATH, ferries, taxis, another operator, the same bus taken
twice, or a subway change between two different stations (whether it stays inside the system is
not known from the legs).

Tested in `apps/server/tests/journeys-fares/`, with the real Transitous capture.
