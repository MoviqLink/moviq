# Events

`/api/events`: the events of New York from every source of events, read through the data
platform. Nothing here calls a provider, and nothing is sold: each event carries only the
official pages its sources give.

| File          | Responsibility                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- |
| `routes.ts`   | `eventRoutes({ reader, clock })`: `GET /?from=&to=&bbox=&category=`                       |
| `query.ts`    | The query, validated; which events fall in it                                             |
| `catalog.ts`  | Reads every family, merges, cuts to the query and cites each family with its state        |
| `families.ts` | A family of sources (Ticketmaster's fourteen windows, NYC Parks, each venue) and its read |
| `merge.ts`    | One event once: the only rule that merges two listings                                    |

The query: `from` and `to` are UTC instants (now and a week later by default, 15 days at most),
`bbox` is `west,south,east,north`, `category` a comma list of `eventCategorySchema`. An event is
served while it has not ended; one without an end only until it starts, since whether it is
still on is not known.

The merge rule: two listings of different families are one event only when they start at the
same instant at venues within 100 m, and each is the other's only match. Never by a similar name.
A family listed first (Ticketmaster, then the venues, then NYC Parks) gives the words and link;
every listing stays, with its source and the time of its data.

Every family is cited with the state of each of its files: a family without data is
`served: false` with the evidence (such as `Needs TICKETMASTER_API_KEY, which is not set.`), and
one with a file missing or a page cut short is `complete: false`. A new kind of source joins as
one more `EventFamily` in `defaultEventFamilies()`.
