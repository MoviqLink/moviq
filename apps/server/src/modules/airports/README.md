# Airports

The departures and arrivals boards of JFK, LaGuardia and Newark: AeroDataBox's FIDS for the
timetable, terminal and status, ADS-B for what moves between two boards, and the FAA's status.
Served at `GET /api/airports/:code/board?direction=departures|arrivals` (`airportBoardSchema` in
`@moviq/contracts`), with "Flight data by AeroDataBox" in `attribution`, as its free plan requires.

| File            | Responsibility                                                                     |
| --------------- | ---------------------------------------------------------------------------------- |
| `airports.ts`   | The three airports: IATA and ICAO codes, names, FAA reference points (form 5010)   |
| `movements.ts`  | Where an aircraft is against an airport: phase, distance, landing or take-off time |
| `call-signs.ts` | `AAL100` ↔ `AA 100`, with the airlines of the boards and the ones MovIQ knows      |
| `match.ts`      | The board crossed with ADS-B by call sign and time, and why the rest match nothing |
| `board.ts`      | `createAirportBoardService`: the board, ADS-B, the usual routes and the FAA        |
| `rebooking.ts`  | `nextDepartures`: real departures to the same destination after a missed flight    |
| `routes.ts`     | `airportRoutes`: the API, with the query validated by `boardQuerySchema`           |

The board itself is read by `createAirportBoards` in `data-platform/on-demand/`, which owns the
requests and the units.

## Units: one count for boards and flights

AeroDataBox's free plan gives 400 units a month and one request a second; a board (FIDS, one
airport, both directions, 12 hours from 2 hours ago) is Tier 2 and costs 2 units, like the
traveller's Flight Status. Both go through one gateway with one count, so they never send two
requests in the same second and the gateway's own count (`x-ratelimit-api-units-remaining`,
shared by every process with the key) decides for both. The rules, in order:

1. 40 units are never spent (a restart, checks).
2. 100 more are kept for the traveller's flight: boards stop there, flights go on to the 40. A
   watched flight costs about 20 to 24 units (asked every 3 hours, then every 20 minutes in its
   last 3), so 100 cover four watched flights even if the boards had spent all theirs.
3. A board is refreshed only when someone asks for it (Explore, Sara, the simulator) and at most
   every 3 hours per airport: 8 a day per airport, 24 for the three, 48 units a day at most.
4. What is left above 140 is spread evenly over the UTC days until the month renews, worked out
   again each day, so a quiet day leaves its units to the next. Until the end of the
   competition's evaluation (15/12/2026 in New York, `EVALUATION_ENDS` in `on-demand/index.ts`),
   the units are spread up to that day instead, if it comes first.

With the 394 units left after the capture of 11/11/2026 and the month renewing on 11/12/2026 at
03:38:44 UTC (`x-ratelimit-api-units-reset`):

| Days                        | Units for boards a day            | Boards a day                         |
| --------------------------- | --------------------------------- | ------------------------------------ |
| From 11/11                  | (394 − 140) / 31 days = 8.2       | 4                                    |
| 1/12 to 10/12 (evaluation)  | (360 − 140) / 11 days = 20        | 10: each airport every 7 hours       |
| 12/12 to 15/12 (evaluation) | (400 − 140) / 5 days = 52         | 24, the 3-hour limit: all that asked |
| 16/12 to 10/1/2027          | what is left, 20 to 260 / 26 days | 0 to 5                               |

The 1/12 line assumes 360 units left then; on 11/12 the month renews at 22:38 on 10/12 in New
York, and the next UTC day starts with the new 400. After the evaluation the boards have spent
most of their share, so they are rare until the next renewal while flights keep their 100;
`budget.test.ts` checks each line. A board kept past its 3 hours, because
the provider is down (asked again after 15 minutes) or the units do not allow a new one, is served
as `kept` with its time and why; after 7 days (AeroDataBox's terms) it is dropped and the board
says there is none. Boards live in the process's memory: a restart starts without them.

## What ADS-B adds between boards

Positions from adsb.lol, adsb.fi standing in, newer than 15 minutes. Around each airport:

- `on-ground` under 5 knots, `taxiing` from 5, `on-runway` from 40, within 3 NM of the reference
  point;
- `approaching`: in the air, the track within 45° of the airport and under a 3° glide path with
  room (1,000 ft plus 350 per NM); its landing is worked out from the distance and the ground
  speed only while it heads for the airport;
- `departed`: in the air, the track within 60° of the way out, within 12 NM and under a climb of
  1,500 ft plus 800 per NM; its take-off is worked out back from the distance and the speed.

An aircraft flies a flight of the board when its call sign is the flight's (AeroDataBox's, or the
airline's ICAO code and the digits) and the flight's time here is close to now: from 3 hours before
to 1 after for a departure, from 2 before to 3 after for an arrival. In the air, an arrival must
not be heading away, a departure not heading in. Every other aircraft moving at the airport is
listed in `aircraft.unmatched` with its reason: `no-call-sign`, `not-a-flight` (a registration,
an ATC-only call sign), `not-on-board`, `off-schedule` (on the board at another time) or `no-board`.
The usual route of a call sign (Virtual Radar Server) is where it usually flies, never today's
plan: `otherEnd` is null when it does not pass through the airport.

The JFK board and ADS-B taken 3.5 minutes apart on 11/11/2026 show why both are needed: AV 245
was 2 NM out climbing while AeroDataBox still said `Expected`; BR 31 was taxiing while it said
`Departed` (from the gate); CM 804 had landed while it said `Expected`.

## What the JFK board of 11/11/2026 showed

199 departures and 160 arrivals in 12 hours, 282,862 bytes. No gate at all; a terminal for 95 %;
AeroDataBox's live layer (`basis: live`) for 25 % of departures and 60 % of arrivals, the rest
from the timetable. `withCodeshared=false` still lists some departures twice, under the airline
and under its group's operator (LA 1453 and XL 1453, AV 7393 and 2K 7393): the board shows them
as listed, and `nextDepartures` offers each once (`alsoListedAs`).

## For the ticket simulator

`nextDepartures(boards, { destination, after, number }, now)` gives the departures to the same
destination from the three airports after a delayed or missed flight, soonest first, without
cancelled or departed ones nor the missed flight under any of its numbers, and what each board
covers (`coveredUntil`), so nothing is said about later hours. Nothing is sold: the simulator
shows them as a simulation.

Tests: `apps/server/tests/airports/`.
