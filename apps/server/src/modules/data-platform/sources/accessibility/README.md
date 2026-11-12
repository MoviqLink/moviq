# Accessibility sources

The definitions below, exported together as `accessibilitySources` from `index.ts`, for
step-free routes on the subway. None needs a key; all are dated by receipt, as no list carries a
time of its own, and all declare `step-free`, which works only while every one can be used.

| File                    | Source                                                                           | Joined by            |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------- |
| `subway-stations.ts`    | MTA Subway Stations, data.ny.gov `39hk-dx4f`: ADA by side                        | GTFS station id      |
| `elevator-equipment.ts` | MTA `nyct_ene_equipments.json`: elevators, GTFS stations                         | Equipment of outages |
| `elevator-inventory.ts` | MTA Elevator and Escalator Inventory, data.ny.gov `94fv-bak7`: status, stand-ins | Equipment code       |
| `subway-entrances.ts`   | MTA Subway Entrances and Exits: 2024, data.ny.gov `i9wp-a4ja`                    | GTFS station id      |

What the providers do, as seen on 11/11/2026:

- The 496 stations of the dataset and the 496 stations of the subway `stops.txt` match one to
  one by `gtfs_stop_id`. `ada` is 0, 1 or 2 (accessible in one direction only, then
  `ada_northbound` and `ada_southbound` say which: the `N` and `S` platforms in GTFS).
  `ada_notes` is the text `NaN` for 488 stations; the other 8 say one direction ("Uptown only",
  "Downtown only", "Manhattan-bound only", "Outbound only"), except 86 St (626): "Uptown local
  only", where the 4 and 5 stop at a platform without an elevator. `complex_id` groups the
  stations of one complex, as the five of Times Sq-42 St.
- The outages feed (`mta/elevators.ts`) names the equipment and the station by name only; all
  184 outages of that day name equipment of the list, which gives the GTFS stations it serves
  (`A31/L01`) and whether another elevator does the same (`redundant`). `isactive` is `N` for
  3 ADA elevators (EL306, EL307, EL414), all three out of service in the outages feed too.
- The inventory (`94fv-bak7`, 759 pieces) holds the 707 of the equipment list and 52 more that
  neither the list nor the outages feed names. `service_status_code` gives 11 ADA elevators of
  the list as removed (`RNOS`, "Removed-Non Functioning-Out of Service"), 8 of them with no
  outage in force: EL232 and EL233 at Times Sq-42 St, EL420, EL709, EL331 and EL332 among them. Of the 112
  redundant elevators, 110 name their stand-ins in `redundant_elevator_access`, `_street`,
  `_mezzanine` or `_platform`, as `108, 109, 110`, `718X/716`, `17X+` or `EL204, EL296`; every
  code read that way is one of the inventory. It is checked against the outages, never in their
  place.

- The 2,120 entrances of `i9wp-a4ja` (102 elevators, 10 ramps, 1,629 stairs) name their GTFS
  stations in `gtfs_stop_id`, two for 14 shared entrances (`A12; D13`); every id is a station of
  `stops.txt`. `station_id` stands for two GTFS stations in three cases (12, 28, 517), so the join
  is by GTFS id. The survey says whether an entrance lets people in and out (48 exit only, 7 entry
  only), not whether it is open now. `SubwayEntrance` is the type the engine reads.

`journeys/engine/step-free.ts` joins them with the outages. `json-list.ts` reads a JSON list of
rows with a schema and lists the failures such a list can meet; `portal.ts` holds the failures
of the data.ny.gov portal.

Tests: `apps/server/tests/sources/accessibility/`, against `tests/fixtures/mta/`.
