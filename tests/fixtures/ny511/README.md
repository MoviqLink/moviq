# 511NY captures

Answers of the data routes of 511NY's map, taken on 11/11/2026 between 03:50 and 04:35 UTC (22:50
to 23:35 on 10/11 in New York), one request each, with the generic browser identity and no key.
The times are each answer's `Date`, which the tests use as the time of receipt.

| Capture                    | Origin (`https://api-511x-nysdot.carsprogram.org/` unless said)                        | Date (UTC) | Kept               |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------- | ------------------ |
| `closures.json`            | `events/map-features?eventClassifications=closures&maxBeginDateOffset=300000`          | 03:50:02   | 7 of 215 events    |
| `incidents.json`           | `events/map-features?eventClassifications=incidents`                                   | 03:50:39   | 4 of 20 events     |
| `construction.json`        | `events/map-features?eventClassifications=construction&maxBeginDateOffset=300000`      | 03:50:46   | 5 of 803 events    |
| `future-construction.json` | `events/map-features?eventClassifications=construction&minBeginDateOffset=172800000`   | 04:07:06   | 4 of 232 events    |
| `special-events.json`      | `events/map-features?eventClassifications=specialEvents&maxBeginDateOffset=1210000000` | 03:52:42   | 4 of 73 events     |
| `transit-events.json`      | `events/map-features?eventClassifications=transitEvents`                               | 03:52:38   | 4 of 169 events    |
| `weather-warnings.json`    | `events/map-features?eventClassifications=weatherWarningsAreaEvents`                   | 04:07:17   | Whole: no warning  |
| `road-conditions.json`     | `events/map-features?eventClassifications=winterDriving`                               | 04:07:11   | 4 of 505 segments  |
| `message-signs.json`       | `signs/map-features`                                                                   | 04:07:01   | 6 of 404 signs     |
| `cameras.json`             | `cameras/map-features`                                                                 | 03:50:50   | 6 of 2,901 cameras |
| `crossing-times.json`      | `https://nysdot-special-layers.carsprogram.org/api/v1/travel-times/map-features`       | 04:35:07   | Whole: 8 crossings |

All but `crossing-times.json` were taken by the research of 11/11/2026 (`agente-vektia-a-nyc`)
with the same requests the sources send; `crossing-times.json` was taken for these sources.

Cut by whole features, in their order, envelope unchanged; re-indented by Prettier. Each event
layer keeps events inside the city area, active and not, at least one line where the layer had a
short one, and one event outside the area. The signs keep three of NYSDOT Region 11, two of them
dated ahead of the clock, two of Region 10 in the city and one outside it; the cameras keep two of
NYC DOT, a NYSDOT still, a NYSDOT video, a camera with two views and one outside the area; the
road segments keep one of each condition in the city, the shortest, and one outside it.
