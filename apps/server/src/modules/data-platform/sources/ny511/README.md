# 511NY sources

The layers of 511NY's own map, one source each, exported as `ny511Sources` from `index.ts`. The
map reads its layers from a public configuration (`https://demo.511ny.org/configs/main.json`) and
asks each one at `<api>/map-features?<query>`, without a key; the queries here are the ones of
that configuration, unchanged. Every layer is cut to the city area: the five boroughs, the Hudson
crossings in New Jersey and the first exits in Westchester and Nassau (40.49 to 40.92 N, 74.27 to
73.68 W), keeping a feature whose extent overlaps it.

| Source                      | File                 | Map query or route                                 | Rhythm (base / watched) |
| --------------------------- | -------------------- | -------------------------------------------------- | ----------------------- |
| `ny511-closures`            | `event-layers.ts`    | `closures`, beginning within 5 minutes             | 2 min / 1 min           |
| `ny511-incidents`           | `event-layers.ts`    | `incidents`                                        | 2 min / 1 min           |
| `ny511-construction`        | `event-layers.ts`    | `construction`, beginning within 5 minutes         | 5 min / 2 min           |
| `ny511-future-construction` | `event-layers.ts`    | `construction`, beginning in 2 days or more        | 30 min                  |
| `ny511-special-events`      | `event-layers.ts`    | `specialEvents`, beginning within 14 days          | 15 min / 5 min          |
| `ny511-transit-events`      | `event-layers.ts`    | `transitEvents`                                    | 5 min / 2 min           |
| `ny511-weather-warnings`    | `event-layers.ts`    | `weatherWarningsAreaEvents`                        | 10 min / 6 min          |
| `ny511-road-conditions`     | `road-conditions.ts` | `winterDriving`                                    | 15 min / 5 min          |
| `ny511-message-signs`       | `message-signs.ts`   | `signs/map-features`                               | 2 min / 1 min           |
| `ny511-cameras`             | `cameras.ts`         | `cameras/map-features`                             | 6 h                     |
| `ny511-crossing-times`      | `crossing-times.ts`  | `nysdot-special-layers…/travel-times/map-features` | 5 min / 2 min           |

`provider.ts` holds the licence, the city area, the GeoJSON geometry, the text of HTML
descriptions and the failures; `events.ts` reads any `events` layer.

What 511NY does, as seen on 11/11/2026:

- The map asks each layer at most every 30 s (signs) or 60 s (events): no rhythm here is faster.
  It also asks `<api>/hash?<query>` first and skips a layer whose hash did not change. The
  platform sends one request per run, and these answers carry no `ETag` (only `X-Data-Hash`), so
  each run downloads the layer and an unchanged one is recognised by its content.
- No layer carries its own time: layers are dated by receipt, and each item keeps the time 511NY
  last updated it, which the access agreement asks to show with it.
- The signs of NYSDOT Region 11 (New York City) were dated up to 4.9 hours ahead, as New York time
  written as UTC: when one sign of an agency is ahead, none of that agency's times is shown.
- Waze reports (`wazeReports`) are not read: they come from Waze users, under Waze's terms.
- Weather warnings: none was active, so their format is not seen yet; a warning that does not read
  as an event is refused, not guessed. The National Weather Service alerts (`city/nws-alerts.ts`)
  stay the source of weather alerts; road conditions add the state of the road surface.
- Cameras: only the addresses of pictures and videos are kept, never a picture.
- No key of the configuration (Google Maps, reCAPTCHA) is used.

Licence: the 511NY Developer Access Agreement (`https://511ny.org/developers/daa`) allows
redistribution as long as the meaning of an event is kept and its time shown, credited as
"Powered by 511NY". It covers the official feeds, which 511NY grants through its request form
(`https://511ny.org/help/24`); these routes are the ones its own map uses.

Tests: `apps/server/tests/sources/ny511/`, against `tests/fixtures/ny511/`.
