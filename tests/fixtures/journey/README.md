# Journey captures

One trip captured in one go for `tests/e2e/journey.spec.ts` and `tests/e2e/paypal.spec.ts`: from
1 Hugh J Grant Circle (Parkchester station, in the Bronx) to 89 East 42nd Street (Grand Central)
by 03:17 in New York, asked at 02:01 on 11/11/2026 (07:01 UTC). The subway feed, the plan, its
alternatives and the taxi query were taken within five seconds, so the plan and the trains belong
to the same moment. One request per file, none needing a key, with the generic browser
`User-Agent` the platform sends. JSON files were re-indented by Prettier and are otherwise whole.

| File                                           | Downloaded (UTC) | Origin                                                                                                                                                              | Content                                                                                                                   |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `geosearch-1-hugh-j-grant-circle.json`         | 06:49:49         | `https://geosearch.planninglabs.nyc/v2/search?text=1+Hugh+J+Grant+Circle&size=5`, the query the server sends                                                        | Whole: five matches, the address itself first, 21 m from the station                                                      |
| `geosearch-89-east-42nd-street-manhattan.json` | 03:14:20         | `https://geosearch.planninglabs.nyc/v2/search?text=89%20East%2042nd%20Street%20Manhattan&size=5`                                                                    | Whole: five matches, the Manhattan building first, the Brooklyn address of the same number second                         |
| `subway-1234567.pb`                            | 07:01:45         | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs`                                                                                                | Whole (55,659 bytes, header 07:01:41 UTC, 153 entities)                                                                   |
| `transitous-plan.json`                         | 07:01:46         | `https://api.transitous.org/api/v6/plan?fromPlace=40.833352,-73.861008&toPlace=40.752732,-73.977218&time=2026-11-11T08:12:00Z&arriveBy=true&numItineraries=5&…` (1) | Whole: four itineraries on the 6 from Parkchester every 20 minutes, the latest leaving at 02:27, and one by Bx11, 2 and 4 |
| `transitous-alternatives.json`                 | 07:01:46         | The same with `time=2026-11-11T08:17:00Z`: the alternatives the watch asks for, by the deadline                                                                     | Whole: the same five itineraries                                                                                          |
| `transitous-taxi.json`                         | 07:01:46         | The same with `time=2026-11-11T08:17:00Z&numItineraries=1&transitModes=&maxDirectTime=7200&directModes=CAR`: the watch's taxi query                                 | Whole: one direct trip by car (19 min, 20,434 m), leaving at 02:58                                                        |

(1) The query `planUrl` builds for that trip: `transitModes=SUBWAY,BUS,COACH,REGIONAL_RAIL,
SUBURBAN,LONG_DISTANCE,HIGHSPEED_RAIL,NIGHT_RAIL,FERRY&pedestrianProfile=FOOT&
maxPreTransitTime=900&maxPostTransitTime=900&maxDirectTime=900`, 5 minutes before the deadline.
The destination was looked up on 11/11/2026 at 03:14 UTC, for the trip these captures replace: a
place does not depend on the moment.

## What the feed shows that night

The Lexington Avenue line ran north of Grand Central only: the 4 and the 6 trains of the feed start
and end there (`631N`, `631S`). Transitous planned from the timetable (`realTime: false`), so its 6
trains go on to Brooklyn Bridge, and they reach Grand Central earlier than the feed predicts. The
train of the plan is the same trip in both, `013950`: the feed has it at Parkchester (`608S`) at
02:28:30 and at Grand Central at 03:08:00, 4 minutes after the 03:04 of the plan. The test holds it
2 minutes more (`tests/e2e/support/journey-steps.ts`). The captures are kept as they are: they are
what the providers said.

These captures replace those of 03:15 UTC, from 120 Broadway on the 4: that night no 4 of the
feed called at Wall St, and the watch follows a train only where it stops at the start of the ride.
