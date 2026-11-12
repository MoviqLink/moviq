# Air traffic sources

Three definitions, exported in `airSources` from `index.ts`. None needs a key.

| File             | Source                                                    | Time of the data |
| ---------------- | --------------------------------------------------------- | ---------------- |
| `adsb-lol.ts`    | `adsb-lol-new-york`: aircraft around the airports (`hot`) | `now`            |
| `adsb-fi.ts`     | `adsb-fi-new-york`: the same circle, its stand-in (`hot`) | `now`            |
| `adsb-routes.ts` | `adsb-routes`: the usual route of each callsign (`cold`)  | Receipt          |

`aircraft.ts` reads the ADS-B Exchange v2 answer both providers give (adsb.lol: `ac`, `now` in
milliseconds; adsb.fi: `aircraft`, `now` in seconds) for a circle of 25 nautical miles around
(40.70, -73.95), which holds JFK, LaGuardia and Newark and their approaches. Each aircraft says
how it was placed: `gps` (ADS-B or ADS-R, the aircraft's own satellite position),
`multilateration` or `radar` (TIS-B). Aircraft placed otherwise, or without a position, are left
out and counted. Each position is dated `now - seen_pos`. An answer without any aircraft is
refused: it means the receivers are missing.

- adsb.lol: 500 requests a day without a key, so every 10 minutes at rest and every 5 with an
  interest; ODbL 1.0, with attribution.
- adsb.fi: one request a second; its terms allow personal, non-commercial use only and ask for a
  citation with a link.
- Routes: the Virtual Radar Server standing data (CC0), republished daily by adsb.lol; only the
  routes through KJFK, KLGA or KEWR are kept. A route is where a callsign usually flies, not
  today's flight plan.

Tests: `apps/server/tests/sources/air/`, against the captures in `tests/fixtures/air/`.
