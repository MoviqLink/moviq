# Trip map

- `TripMap.tsx`: one MapLibre map per theme and layout, pitched like a scale model; the route is
  drawn once, then updated in place. If the browser cannot draw it, a sentence says so.
- `style.ts`: the route's colours, and the shared base map (`shared/map/`) quieted, with
  buildings in 3D.
- `layers.ts`: the route (walks on the streets solid and thin along their path, estimated walks
  dotted from place to place, risky legs amber, taxi indigo) and the alternative.
- `markers.ts`: the start, each boarding and the arrival, with name and time.
- `geometry.ts`: lines, bounds, stops and the trimming that draws the route once. A leg without a
  path from the source, and any walk not walked on the streets, is drawn as the straight line
  between its two places.

MapLibre's worker is pointed at its real file, since the bundler moves the module it sits next to.
