# Explore fixtures

Real answers of `GET /api/live/vehicles`, produced by the server over the captures of 11/11/2026
(`tests/fixtures/`), each read at the time of its captures:

- `live-city.json`: the MTA and FAA captures, with bus 8440 reported again 30 s later and 125 m
  further north, so one bus carries a computed speed; every other mode has no data yet.
- `live-air-sea.json`: `?modes=aircraft,ship` at 02:52:40 UTC, over the adsb.lol, adsb.fi and
  Open Waters captures.
- `live-shuttles.json`: `?modes=shuttle,micromobility` at 03:23 UTC, over the Port Authority,
  Passio GO, Lime, Veo and Bird captures.
- `city-layers.json`: `GET /api/city/layers` with every layer asked at 05:30 UTC, over the
  511NY, street, accessibility, harbor, PATH, ferry and NWS captures; cut to the first 10 of the
  2,120 subway entrances, whole items only, the counts unchanged. Its PNCT vessel calls and its
  PATH alert carry the invented vessels, visits and text of the answers written for the tests in
  `tests/fixtures/harbor/` and `tests/fixtures/regional/` (their terms allow no copy).
- `events.json`: `GET /api/events` at 15:00 UTC over the event fixtures; its Ticketmaster and
  venue listings carry the invented names, ids and links of the answers written for the tests in
  `tests/fixtures/events/`.

Every source carries `kind` and `publishedAt` as the server sends them, filled in from the
definition of each source: the day of publication only for the static files their provider dates.
