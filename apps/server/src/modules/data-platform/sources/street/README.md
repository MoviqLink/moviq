# Street sources

What is on the street today, exported as `streetSources` from `index.ts`, and two readers asked on
demand, exported beside it. Everything is a list or a permit, never a live state of a space, a
charger, a defibrillator or a restroom.

| Source                             | File                     | Dataset                                        | Rhythm       |
| ---------------------------------- | ------------------------ | ---------------------------------------------- | ------------ |
| `nyc-street-closures-today`        | `street-closures.ts`     | NYC Open Data `i6b5-j7bu`, blocks closed today | 1 h          |
| `nyc-permitted-events-today`       | `permitted-events.ts`    | NYC Open Data `tvpp-9vvx`, events of today     | 1 h          |
| `nyc-street-permits-<borough>` (5) | `street-permits.ts`      | NYC Open Data `tqtj-sjs8`, in force today      | 6 h          |
| `nyc-parking-meters`               | `parking-meters.ts`      | NYC Open Data `693u-uax6`                      | 1 day        |
| `nyc-ev-chargers`                  | `ev-chargers.ts`         | data.ny.gov `7rrd-248n` (AFDC), five boroughs  | 1 day        |
| `afdc-ev-chargers-new-jersey`      | `afdc-chargers.ts`       | AFDC API, New Jersey side; `NLR_API_KEY`       | 1 day        |
| `nyc-defibrillators`               | `defibrillators.ts`      | NYC Open Data `2er2-jqsx` (AED inventory)      | 1 day        |
| `nyc-landmarks`                    | `landmarks.ts`           | NYC LPC individual landmarks `buis-pvji`       | 1 day        |
| `nyc-public-restrooms`             | `public-restrooms.ts`    | NYC Open Data `i7jb-7jku`, in service          | 1 day        |
| `nyc-parking-signs` (on demand)    | `parking-signs.ts`       | NYC Open Data `nfid-uabd`, by tile             | 1 day/tile   |
| `nyc-permit-stipulations` (demand) | `permit-stipulations.ts` | NYC Open Data `gsgx-6efw`, by permit           | 1 day/permit |

Shared: `socrata.ts` (rows, New York dates, failures, NYC terms), `state-plane.ts` (EPSG:2263 to
latitude and longitude and back, exact to the meters' own coordinates) and `expiring-cache.ts`.

Rules kept in the data, as seen on 11/11/2026:

- Today is the New York day. Closures give days, not hours (3,191 rows, 3,035 blocks, some rows
  repeated whole): a block enters when its days cover today and keeps its first and last day (the
  oldest that day began on 13/08/2026). Events and permits give New York times without zone, read
  as instants.
- The events dataset lists each stretch of an event as its own row (event 911512, a Wednesday
  market, has one row per Wednesday). An event enters when one of its stretches is in force at
  some moment of the New York day, one that ends at midnight does not, and it keeps its
  stretches as published, so it says until when it holds: 34 of the 610 events of that day began
  on an earlier day, the oldest a Parks closure from 30/06/2024 to 31/12/2026. Two stretches of
  one event that day are one event; one id with another name, place or closure is refused.
- A permit (86,000 in force that day) is a window in which work is allowed: neither work going on
  nor a closure. Permits feed the map only; closures come from `nyc-street-closures-today` and
  `ny511-closures`, which are the ones that can stop a route.
- Parking meters: `Active` is the meter, not a free space; 2,763 inactive meters are counted
  apart, and a number listed twice with different places is left out.
- Parking signs: 441,086 current signs (156,217 in Brooklyn) do not fit one list, so they are asked
  by tiles of 1,000 feet of the state-plane grid the dataset uses (157 signs in the tile of 10 Av
  and W 57 St) and kept a day. A sign is shown with its text: hours, days and exceptions are never
  resolved into "allowed now".
- Chargers: the five boroughs come from New York State's copy of the AFDC list (848 stations by
  ZIP code); the New Jersey side comes from the AFDC API, asked for New Jersey only, so no station
  appears twice, with its pricing. The AFDC status is the listing (open, planned, temporarily
  unavailable), never free or in use. Without `NLR_API_KEY` that source is `misconfigured` and
  sends nothing. The API allows 1,000 requests an hour per key
  (`https://developer.nlr.gov/docs/rate-limits/`); data "may be used for any purpose" without
  endorsement (`https://developer.nlr.gov/terms/`).
- Defibrillators: the map `2ync-kihj` is a view of the inventory `2er2-jqsx`, which gives the
  building, the place inside and the units, but no hours: none is said to be reachable now.
- Public restrooms: 1,100 rows, 998 `Operational`; the others (`Not Operational`, `Closed for
Construction`, `Closed`) are counted and never served, and so is one in service whose note keeps
  it for maintenance staff. A place listed twice with the same name and point is one restroom
  (Tompkins Square Park). All are free. The hours stay as published, line by line (165 forms,
  `8am-4pm, Open later seasonally` for 613 park restrooms, weekly tables for the libraries, some
  contradicting themselves, as `Tuesday: 10:00 pm - 6:00 pm`): never read as "open now". A note
  that names a key or a code marks the restroom as needing one; the note itself stays in English.

Licences: NYC Open Data under the City's terms of use (`https://www.nyc.gov/main/terms-of-use`);
data.ny.gov under the Open NY Terms of Use.

Tests: `apps/server/tests/sources/street/`, against `tests/fixtures/street/`.
