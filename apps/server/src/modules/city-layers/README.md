# City layers

`/api/city`: what the data platform already gathers about the city, for Explore's panel and map:
transit alerts, road incidents, closures and works, street permits and permitted events, traffic
cameras, chargers, defibrillators, public restrooms, subway entrances, parking meters and signs, the harbor and the
weather on the roads. Nothing here calls a provider on a schedule: each layer reads its sources
through the platform. Only two routes ask a third party, on demand: a camera's still picture and
the parking signs of one tile.

| File                | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| `routes.ts`         | `cityLayerRoutes({ reader, clock, http })`: the four routes below            |
| `catalog.ts`        | Every layer read once every 15 s for every screen, cut to the box and capped |
| `layer.ts`          | A layer of one or more sources; items checked against the contract           |
| `layers/`           | The layers by group: transport, street, places, harbor, weather              |
| `geometry.ts`       | A GeoJSON geometry as the mark and lines of an item; the box test            |
| `camera-images.ts`  | A camera's still, asked once a minute per camera, validated, kept in memory  |
| `parking-signs.ts`  | The signs of the tile around a point, through `createParkingSignsReader`     |
| `restrooms-near.ts` | The public restrooms in service nearest to a few points, in a straight line  |

Routes:

- `GET /layers?layers=a,b&bbox=w,s,e,n`: every layer counted in the whole city with its state;
  the items of the layers named, inside the box. A layer with more than 2,500 items in the box is
  listed in `capped` with how many it holds. With no source served, a layer is `unavailable`,
  never "none".
- `GET /cameras/<id>/image`: the still of a 511NY camera. `id` is the camera's id in the list,
  digits only: the route never takes an address. The picture is the one the list gives (the
  still, or the still of the video), asked over public HTTPS only, with the generic browser
  identity, at most once a minute per camera and 120 times a minute for every camera together.
  Its type is read from its bytes (an owner labels PNG stills as JPEG), up to 2 MB, and its time
  is the owner's `Last-Modified` (`x-image-time-basis: source`) or the moment it was received.
  Failures answer `503` with `cameraImageFailureSchema`.
- `GET /parking-signs?lat=&lon=`: the current signs of the 1,000-foot tile around a point, with
  their text as DOT lists it, asked of NYC Open Data at most once a day per tile.
- `GET /restrooms?near=lat,lon;lat,lon&stepFree=1`: the public restrooms in service nearest to
  one to four points (the next stops of a trip), within 800 m in a straight line, three for one
  point and two for each of several, one near two points listed once. The distance is the
  straight line to the nearest 10 m, never a walk; with `stepFree=1` the fully accessible ones
  come first. Read from `nyc-public-restrooms` only: every one is free. `restrooms` is null when
  the list cannot be read.

What each layer shows, and why:

- Street permits are windows in which work is allowed, placed by street name only: counted by
  borough and never drawn, and never a closure. Permitted events are placed in words: listed with
  the closure their permit states, their real start (an earlier day for a permit of months) and
  each stretch in force today.
- PATH alerts open now and those closed today (PATH closes a one-off notice as it sends it);
  ferry alerts within their periods; Coast Guard notices not cancelled nor past their own end;
  PNCT calls not departed before today; NWS alerts not expired.
- Each item is checked against `cityItemSchema` once per version of its source: one item a
  source words oddly is left out and counted (`leftOut`), so it never refuses the whole answer.
- Licences travel with each source (`sources`): 511NY's "Powered by 511NY" with the time of each
  event; NYC Open Data, data.ny.gov, NOAA, the Coast Guard, PNCT, PATH and the ferries as their
  definitions credit them.

Tests: `apps/server/tests/city-layers/`.
