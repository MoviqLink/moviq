# Harbor sources

Six definitions for New York Harbor, exported together as `harborSources` from `index.ts`. None
needs a key.

| File                      | Sources                                                         | Time of the data           |
| ------------------------- | --------------------------------------------------------------- | -------------------------- |
| `coast-guard-notices.ts`  | Coast Guard Sector New York broadcast notices to mariners (RSS) | Receipt: the feed has none |
| `pnct-vessel-schedule.ts` | Vessel calls at Port Newark Container Terminal (page)           | Receipt: the page has none |
| `noaa-ports.ts`           | NOAA PORTS: water level, air gap, current and wind (`warm`)     | Newest measurement (6 min) |

Shared pieces: `html-text.ts` turns HTML fragments and character references into text, for the
notices and the page; `noaa-ports-reading.ts` reads one NOAA answer into one observation.

What the providers publish, as seen on 11/11/2026:

- The Coast Guard feed holds the latest 100 notices, whatever their age. Each title gives a
  category, a waterway, a subject and a reference (`SEC SNY BNM 0556-26`); a notice ends at its
  own `CANCEL AT//DDHHMMZ MON YY//` time or when a later cancellation names its reference. The
  point-of-contact line, which names a person and a telephone, is never kept.
- PNCT embeds the list it shows in the `data-ds` attribute of its schedule block: expected and
  actual arrival and departure (`Arrival` and `Departure`, headed "ActualArrival" and
  "ActualDeparture"), in New York wall-clock time without a zone. The PDF schedules of Maher and
  Port Liberty Bayonne are not read: the platform has no PDF reader.
- NOAA asks each caller for an `application` name: the sources send `public-transit-viewer`, a
  neutral description that names nobody. Water level is metres above Mean Lower Low Water, air
  gap metres under the Verrazzano-Narrows Bridge, current centimetres per second and wind metres
  per second, all in GMT. The Narrows currents (`n03020`) and the wind at The Battery gave no
  data, so Kill Van Kull (`n06010`) and Robbins Reef (`8530973`) stand for them.

Tests: `apps/server/tests/sources/harbor/`, against the captures in `tests/fixtures/harbor/`.
