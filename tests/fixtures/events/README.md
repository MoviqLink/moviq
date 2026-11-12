# Event captures

Answers behind `apps/server/src/modules/data-platform/sources/events/`. The NYC Parks one was
taken on 11/11/2026 with the same generic browser `User-Agent` the platform sends (no contact, no
project name) and cut by whole elements, kept in their order; the others are written for the tests
(below).

| File                            | Downloaded (UTC) | Origin                                                                                                                                                                     | How it was cut                                                                                                                                                                                                                                                                   |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticketmaster-events.json`      | Written          | In the shape of `https://app.ticketmaster.com/discovery/v2/events.json` (`geoPoint=dr5ru7&radius=25&unit=miles`, the day of 11/11/2026, `size=200&sort=date,asc&locale=*`) | Written for the tests: 12 events with invented names, ids and pages (`tm-test-01` to `12`), kept to the fields the reader takes, at real venues and times: two long admissions, a tour without time, a cancellation, the concerts also on the venue pages; `page` says 12 of 247 |
| `nyc-parks-events.json`         | 04:51:04         | `https://data.cityofnewyork.us/resource/w3wp-dpdi.json` with the definition's own `$select`, `$order=guid` and `$limit=5000`                                               | 578 rows cut to 12, whole: two without start or place, one with two places, one cancelled in its title, one per category                                                                                                                                                         |
| `irving-plaza-shows.html`       | Written          | In the shape of `https://www.irvingplaza.com/shows`                                                                                                                        | Written for the tests: 7 schema.org `MusicEvent` blocks with invented names and pages, at the venue and times of the page, one at the 00:00:01 placeholder                                                                                                                       |
| `brooklyn-paramount-shows.html` | Written          | In the shape of `https://www.brooklynparamount.com/shows`                                                                                                                  | Written for the tests: 6 schema.org `MusicEvent` blocks with invented names and pages, at the venue and times of the page                                                                                                                                                        |

Ticketmaster's terms of use (`https://developer.ticketmaster.com/support/terms-of-use/`) forbid
to "Cache or store any Event Content other than for reasonable periods in order to provide the
service you are providing"; a copy kept in a repository is neither. The venue pages are Live
Nation's, under the terms they link (`LIVE_NATION_TERMS_URL` in `venues.ts`, unread behind a
browser challenge on 11/11/2026), with no licence for their content. So none of those answers is
kept: they are written by hand in the shape of the API and of the pages' JSON-LD, with invented
names, identifiers and links (`ticketmaster.com/test-…`), no images, and the venues, times,
categories and statuses that cover the same cases; the merge of one concert listed twice is kept
at Irving Plaza and Brooklyn Paramount.
