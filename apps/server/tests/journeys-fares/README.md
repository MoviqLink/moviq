# Fare tests

`omny.test.ts` prices the three real itineraries of `tests/fixtures/on-demand/transitous-plan.json`
and legs built with Transitous' ids: one fare with a free transfer, changes inside a station, the
two-hour window, a trip on foot, and every leg without a verified rule, which leaves the fare
`null`. It also pins the figures to the MTA fare page they come from.
