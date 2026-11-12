# Harbor captures

Taken on 11/11/2026 by the research of that night, one request per file, with the generic
browser identity and without keys, cookies or `Referer`. Times are UTC (New York: five hours
earlier, on 10/11/2026).

| Capture                           | Origin                                                                                                         | Taken (UTC) | Kept                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `uscg-sector-new-york.rss`        | `https://public.govdelivery.com/topics/USDHSCG_379/feed.rss`                                                   | 04:00:30    | 25 of 100 items, whole, in their order: the newest 19 and 6 other kinds |
| `pnct-vessel-schedule.txt`        | Written for the tests in the shape of `https://www.pnct.net/VesselSchedule`                                    | -           | 35 invented calls in its `data-ds` list                                 |
| `noaa-battery-water-level.json`   | `api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8518750&product=water_level&datum=MLLW&date=latest` | 03:40:01    | Whole; one value                                                        |
| `noaa-verrazzano-air-gap.json`    | `…/datagetter?station=8517986&product=air_gap&date=latest`                                                     | 03:40:32    | Whole; one value                                                        |
| `noaa-kill-van-kull-current.json` | `…/datagetter?station=n06010&product=currents&range=1`                                                         | 03:40:56    | Whole; the last hour, 9 values                                          |
| `noaa-robbins-reef-wind.json`     | `…/datagetter?station=8530973&product=wind&range=1`                                                            | 03:40:59    | Whole; the last hour, 10 values                                         |
| `noaa-narrows-no-data.json`       | `…/datagetter?station=n03020&product=currents&range=1`                                                         | 03:40:47    | Whole: NOAA's "No data was found" answer                                |

Every NOAA request also asked for `units=metric&time_zone=gmt&format=json`; the captures were
taken without the `application` parameter the sources now send, which does not change the
answer. The JSON files were re-indented by Prettier.

Changes beyond removing items, for privacy:

- `uscg-sector-new-york.rss`: the two point-of-contact lines (`POC:`, a person's name and a
  telephone) removed from their notices, as the source never keeps them.
  PNCT's page is not kept: it states "PNCT © 2026. All rights reserved." and its Terms of Use page
  was empty on 11/11/2026, so nothing of it may be handed on. `pnct-vessel-schedule.txt` is written
  for the tests: the schedule block (`divVslSchedules`) with a `data-ds` list in the page's shape, 35
  invented vessels, visits and voyages (`TEST VESSEL 01` to `35`), and for each call the times of
  one call of the page of 11/11/2026, so the same stages are covered (2 at berth, 7 gone, the others
  announced, one announced long after its expected arrival). Saved as `.txt` so that Prettier leaves
  the HTML as written.
