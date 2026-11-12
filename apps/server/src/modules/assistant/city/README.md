# City

What Sara answers about New York, read through the data platform's `SourceReader` and the city
Explore shows (`live/city.ts`); nothing here calls a provider. Each tool returns a `Finding`
(`findings.ts`) whose figures and times all come from a source read this turn, with every source
cited (`CitySource`: title, time of the data, state). A source that cannot be read is `null` in
the finding, never an empty list, so the words say "I can't check it now", never "no incidents";
a copy too old to rely on cannot say that nothing is in force either.

| File                | Responsibility                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `ports.ts`          | `CityPorts` (reader, Explore's city, database), sources as cited, the trip under watch   |
| `lines.ts`          | Lines and modes as travellers name them (`A`, `línea 7`, `M15 SBS`, `PATH`, `ferri`)     |
| `alerts.ts`         | Alerts in force: MTA by route, stop or agency; NYC Ferry and NY Waterway; PATH open      |
| `live-line.ts`      | The vehicles of a line in Explore, the feeds of each subway route, their sources         |
| `line-status.ts`    | `line_status`: alerts, vehicles followed, buses late, trains held, trips cancelled       |
| `incidents.ts`      | `incidents`: on a line, at a station, in a mode (FAA programs too) or along the trip     |
| `where-is.ts`       | `where_is`: position, its basis (GPS, GPS+, by station, timetable), next stop and time   |
| `stations.ts`       | Stations by name, and the lines with trains due at each in the MTA live feeds            |
| `station-access.ts` | `station_access`: outages now and announced, stand-ins, step-free access by direction    |
| `reliability.ts`    | `line_reliability`: intervals, bunching and stoppages from `moviq-recorder-stats`        |
| `restrooms.ts`      | `restrooms_near`: free public restrooms near the trip's next stops, a station or a place |
| `ask.ts`            | One question: the tool run, its result kept for the reply, its facts for the model       |
| `tools.ts`          | The six tools offered to the model, each with its strict schema                          |
| `guard.ts`          | The times, numbers and language the model's words may have: only what was given          |
| `words*.ts`         | The cards and fixed words in English and Spanish                                         |
| `reply.ts`          | The fixed reply of a city turn, with the trip's open question when one is being planned  |

Rules kept by the words: a station that is accessible always carries the warning that it does
not guarantee the route; MTA and PATH alerts are quoted in English as published, and the Spanish
reply says so; a line measured on fewer than 20 intervals in a band, or on another type of day,
has no figure yet ("not enough data yet"). Until the recorder publishes, that is the answer.
Restrooms come only from the city's list of public restrooms, so every one is free: the distance
is said as a straight line, the hours as published (in English, and the Spanish reply says so),
never as "open now"; on a step-free trip the fully accessible ones come first, and it is said.

Tested in `tests/assistant/city-*.test.ts`.
