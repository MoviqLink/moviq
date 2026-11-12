# Regional rail captures

Taken on 11/11/2026 between 02:21 and 02:25 UTC (10/11/2026, 21:21 to 21:25 in New York), one
request per file, with the generic browser `User-Agent` the platform sends. No feed needed a key,
so no address carries one.

| Capture                   | Origin                                                            | Taken (UTC) | Kept                                                                                                               |
| ------------------------- | ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `lirr-realtime.pb`        | `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr` | 02:21:48    | 13 of 181 entities: train 566 (reported at 00:42), the 5 trains reported last, their trips, one trip without train |
| `metro-north-realtime.pb` | `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr`   | 02:21:52    | 7 of 114 entities: 3 trains with GPS, 2 placed by their stop, 2 trips not started                                  |
| `gtfslirr.zip`            | `https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip` (1.8 MB)      | 02:23:23    | 31 of 1,871 trips: two per route and the 7 trips of the live capture                                               |
| `gtfsmnr.zip`             | `https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip` (4.4 MB)       | 02:23:26    | 19 of 37,336 trips: two per route and the trains of the live capture running that day                              |
| `path-ridepath.json`      | `https://www.panynj.gov/bin/portauthority/ridepath.json`          | 02:24:46    | Whole: 13 stations, 52 arrivals; re-indented by Prettier                                                           |

PATH alerts are not kept: their texts are the Port Authority's own, published under the
panynj.gov Web Site Disclaimer (`https://www.panynj.gov/port-authority/en/web-site-disclaimer.html`)
with no licence to hand them on. `path-alerts.json` is written for the tests in the shape of
`https://www.panynj.gov/bin/portauthority/alerts?agency=PATH`: 5 messages with invented texts and
ids, the kinds (`TemplateName`), states and send times of the answer of 11/11/2026 at 03:56:13 UTC,
an update and a final update of one incident, and the lines one of them names.

Live feeds were decoded, cut to whole entities and encoded again with `encodeGtfsRealtime`,
header unchanged; MTA railroad extensions are not part of the schema and drop out.

Timetables were cut by rows only: `agency`, `feed_info`, `calendar_dates`, `routes` and `stops`
whole; `stop_times` holds the rows of the first three trips kept; `shapes`, `transfers` and
`notes` left out. Entries keep their dates as the publisher wrote them: 15:33 on 10/11/2026 for
LIRR (which is neither New York time nor UTC) and 14:40, New York time, for Metro-North.
