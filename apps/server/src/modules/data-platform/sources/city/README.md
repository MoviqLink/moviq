# City sources

New York context around a trip, all `realtime` on the `warm` rhythm and without credentials.
`index.ts` exports `citySources` for the catalogue and the normalised types for consumers.

| File                        | Source                                                                                        | Time of the data |
| --------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| `faa-airport-status.ts`     | FAA NAS Status for JFK, LGA and EWR: ground stops, ground delay programs, delays and closures | `Update_Time`    |
| `nyc-dot-traffic-speeds.ts` | NYC DOT traffic speeds (NYC Open Data `i4gi-tjb9`), with suspect links kept apart             | newest reading   |
| `nws-alerts.ts`             | NWS active alerts for the five boroughs' forecast zones                                       | `updated`        |
| `nws-hourly-forecast.ts`    | NWS hourly forecast for a fixed Midtown Manhattan grid cell                                   | `updateTime`     |

Helpers: `faa-nas-status-xml.ts` reads the FAA XML, `nyc-dot-link-points.ts` turns
`link_points` into validated `[longitude, latitude]` pairs, `parsing.ts` holds the shared refusals
and `nws-licence.ts` the NWS licence. Socrata's zone-less New York times are read with
`infrastructure/clock/new-york.ts`.

Each definition explains its rhythm, freshness and licence next to it, and lists its known
failures. No answer from a provider is ever read as "no incidents": an empty list is only valid
when the provider says so in a well-formed answer.

Tested in `apps/server/tests/sources/city/` against real captures in `tests/fixtures/city/`.
