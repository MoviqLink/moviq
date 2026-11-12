# Explore map

- `ExploreMap.tsx`: the map, its sources, the selection brought into view once, the single move.
- `layers.ts`: the layers: parked vehicles as small dots, places as rings, vehicles as marks.
- `events-layer.ts`: events as dots in MovIQ's lime under the vehicles, grey when called off.
- `city-layer.ts`: the city layers under everything else: streets and roads as lines, items as
  dots, red for what is closed, amber for a risk, ink for places.
- `radar-layer.ts`: NOAA's radar mosaic (public domain) over the base map, swapped with no fade.
- `basemap.ts`: the shared base map (`shared/map/`), flat with no pitch or raised buildings, USGS
  regional aerial imagery, NYS 2024 street detail and the two views (2D and aerial). Switching views preserves the whole camera.
- `marks.ts`: MovIQ's colour for each mode, never an operator's; an arrow for vehicles on a line,
  a plane and a hull of our own, a disc without course; the GeoJSON features.
- `motion.ts` (pure): each answer gives a vehicle a linear glide from where it is drawn to its new
  reading, lasting as long as it took to report again (4 to 40 s), the course turning the short way.
  A new vehicle, or one that moved further than its mode can, is placed at once. Every drawn point
  lies between two real readings; nothing is projected past the latest one. Places never move.

- `trails.ts`: a short line under each vehicle through the points it was drawn at in the last 30 s,
  in its mode's colour, fading towards the tail in three steps; one GeoJSON source, updated by the
  same loop. Without motion there are no trails.
- `vehicle-diff.ts`: sends only changed vehicle geometry/properties and additions/removals.
- `useMovingMarks.ts`: one `requestAnimationFrame` loop for the whole layer, at most 12 submissions/s,
  one worker update in flight, none while the map is dragged or zoomed; it stops when the page is
  hidden or nothing moves. Reduced motion places each vehicle at its reading. Trains of the selected
  line glide along its verified shape (`rail-motion.ts`).
- `bounds.ts`: reuses the fetched margin during small pans and following; requests a tighter box
  after a substantial zoom. Move-end requests settle for 200 ms.

Aerial imagery overlays the vector ground below labels, with a 350 ms tile fade. Ground remains
visible while imagery downloads and outside the provider's coverage. Tile download latency still
depends on the public provider; there is no fabricated image or extrapolated GPS movement.

- `MapNotice.tsx` and `map-notice.css`: visible loading/failure and retry above the mobile sheet.

Static base/aerial tiles do not refresh solely because a provider returns `max-age=0`; this avoids
repeated background downloads of the same 2024 imagery. NOAA radar retains its explicit two-minute
refresh; vehicle/station/event updates still use their independent live polling. Land vehicles have
upright viewport symbols (bus circles, separate metro/train pictograms); aircraft and vessels keep
map-aligned course. The selected vehicle has a ring and a larger symbol.

- `diagnostics.ts`: at most four deduplicated map failures per instance, sent to the own server
  without identities, user agents or coordinates; URLs and local paths are removed.

USGS imagery supplies the regional photo through zoom 16. NYS detail is requested only from
zoom 16 inside its coverage, above that photo, so a slow detail tile does not expose vector ground.
USGS capture dates vary by area; only the NYS detail is labelled 2024.

- `selected-route.ts` and `route-poller.ts`: fetch the selected vehicle’s verified shape, refresh
  after 30 seconds without overlapping requests, and pause while the page is hidden.
