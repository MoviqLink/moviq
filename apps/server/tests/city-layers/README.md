# City layers tests

`captures.ts` reads every capture of `tests/fixtures/` a city layer uses, each by its own parser
at the time it was taken, through the reader double of `live-vehicles/reader.ts`, and mounts the
routes at `/api/city` with a fake `fetch`.

- `layers.test.ts`: every layer counted, only those asked served, the box, 511NY's words and
  time, permits counted by borough and never a closure, the closure, start and stretches of a
  permitted event, the harbor, a layer without data `unavailable`, one read every 15 s, an odd
  item left out, the cap; the public restrooms in service with their facts.
- `camera-images.test.ts`: the picture of the list with the generic identity and the owner's
  time, once a minute per camera, no address ever taken, the type read from the bytes, the size
  limit, the time of receipt, the list unavailable, 120 pictures a minute, public HTTPS only.
- `restrooms-near.test.ts`: the public restrooms nearest to the stops of the captured trip, the
  straight line to the nearest 10 m, the fully accessible first on a step-free trip, the list
  unreadable said as such, points refused, one restroom near two stops listed once.
- `parking-signs.test.ts`: the signs of a tile with their text, asked once; the dataset down; a
  point outside the city.
