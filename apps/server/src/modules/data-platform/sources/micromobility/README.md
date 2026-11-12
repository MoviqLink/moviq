# Micromobility sources

Four definitions, one per system, exported as `micromobilitySources` from `index.ts`. No key.

| Source          | System                         | Ids      | Report time per vehicle     |
| --------------- | ------------------------------ | -------- | --------------------------- |
| `lime-new-york` | Lime, GBFS 2.2 (Bronx, Queens) | Rotating | `last_reported` (see below) |
| `veo-bronx`     | Veo `nyc`, GBFS 2.2            | Stable   | None                        |
| `veo-queens`    | Veo `nyq`, GBFS 2.2            | Stable   | None                        |
| `bird-new-york` | Bird, GBFS 2.3 (Queens, Bronx) | Rotating | `last_reported`             |

`free-vehicles.ts` reads `free_bike_status`: every vehicle is **parked**, placed by its own GPS
where it was left; vehicles on a rental are not listed. Each one keeps its kind (`scooter`,
`e-bike`, `bike`, from the system's `vehicle_types` of 11/11/2026, null for a type not listed),
whether it is reserved or disabled, its range and, where given, battery and report time. The
time of the data is `last_updated`. `hot`: every 5 minutes at rest, every minute with an
interest.

What can be followed:

- Lime and Bird give new ids in every answer (none in common between answers 13 and 22 minutes
  apart on 11/11/2026): a vehicle is drawn where it stands, never followed from one answer to the
  next. `vehicleIds: 'rotating'` says so in the data.
- Veo keeps its ids (1,328 and 1,319 of about 1,337 in common between the same pairs of answers in
  the Bronx), so a vehicle can be followed while it stays parked.
- Lime's `last_reported` was 16 or 17 seconds before `last_updated` for all 5,291 vehicles on
  11/11/2026: it is the time of the export, not of each vehicle. Bird's is per vehicle (from
  seconds to four days). Veo's file is made on each request and carries none.

A file without any vehicle is refused, and so is one with under half the vehicles served.

Terms: Lime names `https://www.li.me/gbfs-terms` (403 behind a browser check to a plain request),
Bird a PDF of 2018 that answers 404, Veo none (11/11/2026): their text is not yet read.

Tests: `apps/server/tests/sources/micromobility/`, against the captures in
`tests/fixtures/micromobility/`.
