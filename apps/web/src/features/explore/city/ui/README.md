# City layers UI

- `CityPanel.tsx`: the groups, each opened or closed by the traveller, their layers, the parking
  signs and the radar; `TransportLayers` puts the transit alerts under the modes.
- `LayerRow.tsx`: one layer with its count, state, age and what it is; its list while on, a
  permit in force since another day written «until» its end.
- `LayerIcon.tsx`: the stroke of each layer, in the family of the shared icons.
- `CityCard.tsx`: the card of any item and its source with its credit and age.
- `CameraBody.tsx`: the picture through MovIQ, its time, "Refresh" and the video on demand.
- `StreetBodies.tsx`, `UsefulBodies.tsx`, `HarborBodies.tsx`: the facts of each kind of item, in
  the words of its source; an event with a permit lists its stretches of today when it has more
  than one.
- `RestroomBody.tsx`: a public restroom: free and in service, its hours as published (never read
  as "open now"), season, access, stalls, changing table, a key or code, the city's note and page.
- `Facts.tsx`: a label and its value, a titled group and New York times and days.
