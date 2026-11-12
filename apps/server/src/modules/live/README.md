# Live

`/api/live`: every vehicle and place of New York that can be followed, for Explore. Nothing here
calls a provider: each source is read through the data platform and only what can be followed is
kept (a vehicle on a line needs its line, destination and timed stops).

| File                | Responsibility                                                                   |
| ------------------- | -------------------------------------------------------------------------------- |
| `routes.ts`         | `liveRoutes(deps)`: `GET /vehicles?bbox=w,s,e,n&modes=a,b` and `POST /interest`  |
| `line-directory.ts` | Published and active lines, grouped by mode and position source                  |
| `city.ts`           | One snapshot of the city shared by every screen, rebuilt at most every 5 s       |
| `warm.ts`           | `keepCityWarm(city)`: the snapshot rebuilt every 5 s while nobody looks          |
| `feeds/`            | One feed per source; the feeds of one mode are shown as one                      |
| `timetable.ts`      | The timetable of each network and its shapes, read again once a minute           |
| `estimate.ts`       | `PositionEstimator`: what a feed tells the estimator, and the published position |
| `estimation/`       | The estimator: vehicles with GPS along their shape, subway trains by station     |
| `motion.ts`         | Speed and course between the last two GPS reports of each vehicle, in memory     |
| `geo.ts`            | Distance and bearing between two points                                          |
| `sources.ts`        | A source as Explore cites it: credit, static or live, publication and provenance |

`createLiveCity({ reader, clock })` builds with `defaultFeeds()` and the estimator of
`estimation/` before the recorder has measured anything, so with no margin; `feeds` and
`estimate` replace them. `liveRoutes` takes either the same dependencies or a `city`.

The estimator learns only from what is built. `keepCityWarm(city, onError)` builds the city
every 5 seconds from start-up, whether a screen is open or not: a screen asking in between gets
the same snapshot, so the sources are read no more often than with one screen open. The process
that serves the API starts it next to the routes and stops it on shutdown.

`modes` keeps the vehicles and places of those modes only; the counts of every mode stay those
of the whole city, so the panel can count what the map does not draw.

`virtual-bus.ts` extends a map bus to eight published timed stops for virtual boarding. It checks
both feed health and individual GPS age, uses the reported fix, and refuses missing or stale data.

`GET /api/live/lines` returns the published line directory with vehicle counts and source states,
including static lines with no current vehicles. `GET /api/live/vehicles` accepts an optional
`lines` JSON array of `{mode, sourceId, lineId}` identities. An empty array selects no line
vehicles; other modes require explicit `modes`. Omitting `lines` preserves the original response.

`rail-upgrade.ts` also upgrades older Passio GO route snapshots when a worker becomes leader.
It requests a full response only for an old stored representation, respects backoff and
Retry-After, and leaves new or unavailable sources to the normal scheduler.
