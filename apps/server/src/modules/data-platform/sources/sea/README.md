# Sea traffic sources

One definition, `open-waters-new-york-harbor`, exported in `seaSources` from `index.ts`. No key:
Open Waters AIS allows anonymous access to its REST API.

The answer is a GeoJSON collection of the vessels heard in the last 30 minutes inside New York
Harbor and its approaches (40.45 to 40.95 N, 74.30 to 73.65 W). The same truth rules as Vektia's
port map apply:

- a vessel is kept only when its last message is a position report, so `seen` is the time of
  that position; after static data (name, type) the position has no known time and is left out;
- positions more than a minute in the future are left out, and so are those older than 10 minutes
  for a vessel under way (or of unknown speed) and 30 for one stopped;
- one vessel per MMSI; positions at 0,0 or out of range are left out.

The time of the data is the newest position kept. Each vessel says which network heard it
(`AISHub`, `aisstream.io`, `volunteer receivers`), because the licence goes by network: AISHub
must be credited with a link, aisstream.io has no published terms, volunteer receptions are CC0.
Personal use is free; commercial use needs an agreement with Open Waters.

Tests: `apps/server/tests/sources/sea/`, against the capture in `tests/fixtures/sea/`.
