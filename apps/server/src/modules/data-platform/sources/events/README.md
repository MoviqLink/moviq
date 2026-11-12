# Event sources

Events of New York with a venue that has coordinates, a start and an official page, each source
normalised to the same `EventList` (`event-data.ts`). Nothing is completed that a source does not
give: an event without a time, a venue or a page is left out and counted by reason. The
`events` module merges and serves them; `index.ts` exports `eventSources` for the catalogue.

| File                      | Sources                                                                                   | Time of the data |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| `ticketmaster.ts`         | Discovery API, Event Search: reading one page, the official page out of the click tracker | receipt          |
| `ticketmaster-windows.ts` | Fourteen windows of half a New York day (05:00 and 17:00), seven days, one page of 200    | receipt          |
| `nyc-parks.ts`            | NYC Parks Public Events – Upcoming 14 Days (NYC Open Data `w3wp-dpdi`)                    | Socrata load     |
| `json-ld.ts`              | Reading schema.org `Event` entries (JSON-LD) from a page                                  | receipt          |
| `venues.ts`               | Irving Plaza and Brooklyn Paramount calendar pages, once a day                            | receipt          |
| `event-data.ts`           | The shared schema, the reasons to leave an event out and the rules of times and venues    | —                |

Rules shared by every source:

- a start needs its date, time and zone; a time to be announced, a date alone, Ticketmaster's
  `timeTBA` and Live Nation's 00:00:01 placeholder are not a start;
- an event open for more than a day, or started more than a day ago, is an exhibition or an
  admission (`long-running`), not an event to arrive on time to;
- the venue must be inside the New York area of a trip (`eventVenueSchema`);
- the status is the source's: Ticketmaster's code, schema.org's `eventStatus`, and NYC Parks'
  `CANCELLED:` at the start of a title. Nothing is said about price: no source gives one here.

Access and terms:

- **Ticketmaster** (`TICKETMASTER_API_KEY`; without it no request is made and the sources are
  `misconfigured`): 5,000 calls a day and 5 a second in the documentation, 2 a second in the FAQ;
  deep paging stops at the 1,000th event. The windows make 176 calls a day, one at a time in the
  static lane. Terms: <https://developer.ticketmaster.com/support/terms-of-use/> (27/06/2023):
  Event Content belongs to the organisers and/or Ticketmaster, purchases are governed by
  Ticketmaster's terms, content is cached only for reasonable periods and removed within 24
  hours if its owner asks, and the application's identity is not concealed. MovIQ shows the
  credit "Event data from the Ticketmaster Discovery API", no logo, and links to the event page.
- **NYC Parks**: NYC Open Data under the NYC.gov terms of use, updated daily. `image` (a third
  party's picture) and `contact_phone` are not read.
- **Venue pages**: robots.txt allows everything; one GET a day with the generic identity. The
  Live Nation terms linked from both pages answered with a Cloudflare challenge on 11/11/2026 and
  were not read; a challenge is never worked around. Probed on 11/11/2026 and left out: Madison
  Square Garden and Radio City (schema.org events only on each event's page, one request per
  event), Barclays Center, Lincoln Center, Apollo Theater, BAM, The Town Hall, Jazz at Lincoln
  Center, Webster Hall, Terminal 5, Gramercy Theatre, Brooklyn Bowl, Le Poisson Rouge, Elsewhere,
  Blue Note, Bryant Park, Little Island (no event in JSON-LD), Symphony Space (one entry for the
  whole page, without a date), Carnegie Hall, the Met Opera and The Shed (Queue-it waiting room),
  Kings Theatre (Cloudflare 403), and the New York Philharmonic, City Center, Palladium Times
  Square, Pier 17 and the Joyce Theater (no calendar page found or no answer).

Tested in `apps/server/tests/sources/events/` against real captures in `tests/fixtures/events/`.
