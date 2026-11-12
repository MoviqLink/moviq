# My trips

`#/trips`. The server has no list of a traveller's trips, so this browser keeps the ids of the
trips it opened (`saved.ts`, at most 20, newest first, ids only) and asks for each one at
`GET /api/journeys/:id`, which answers only its owner. A 404 forgets the id; any other failure says
the trip cannot be read now and offers to try again.

- `saved.ts`: the ids in `localStorage`.
- `load.ts`: one trip asked for and its answer read.
- `model.ts`: the list after each answer, and how a trip stands (watched, finished, cancelled).
- `useTrips.ts`: the list for the screen.
- `TripRow.tsx`, `trips.css`: a trip as stops on one line through time, shown in My trips.
