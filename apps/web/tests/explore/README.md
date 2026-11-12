# Explore tests

- `card.test.ts`: how the card writes signal, margin, course, speed, delay, ages and stop names,
  and that English and Spanish carry the same words.
- `modes.test.ts`: ship types, minutes to a train, the stoppage sentence with its evidence, the
  words of every mode, and the marks of aircraft, ships, shuttles and parked vehicles over
  `fixtures/live-air-sea.json` and `fixtures/live-shuttles.json`.
- `motion.test.ts`: a linear glide between two real readings, never past the latest; new or
  impossible moves placed at once; course turned the short way; trains along a verified shape.
- `fixture.test.ts`: `fixtures/live-city.json` matches the contract; next stop and nearest.
- `events.test.ts`: today, tonight and the weekend in New York time, across the change of the
  clocks; the providers missing, the kinds, the link to Sara and the marks over
  `fixtures/events.json`, which the server built from the real captures; the same words in both
  languages, none about buying or booking.
- `city.test.ts`: which city layers are asked (incidents first, dense layers on a zoom, signs by
  their own route), what is drawn and listed, the notes of a layer on, the counts of a group,
  the age of a layer, the tones of the marks, NOAA's radar address and the same words in both
  languages, over `fixtures/city-layers.json`; a permit in force since 2024 listed until its end.
- `legible.test.ts`: bike share and parked vehicles off at first; the panel without the list of
  sources, each mode with its state; a timetable written in force since its day of publication,
  live data by its age, and a file its provider does not date never called published; the
  stretches of an event with a permit on its card when it has more than one.

- `poll.test.ts`: a change of view or unmount stops its timer and a late answer.

- `vehicle-diff.test.ts`: unchanged fleet produces no worker update; one moved vehicle sends one
  geometry; selection changes no geometry; vanished vehicles are removed; viewport margin reuse.
