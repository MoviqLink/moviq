# Shared map

`base-style.ts`: the base map of Explore and the trip, in one place. OpenFreeMap's Positron by day
and Dark by night (`styleUrl`), drawn without points of interest, shields or road references such
as `I 95;NJTP` (`withoutClutter`, MapLibre's `transformStyle`), so only the names of streets,
neighbourhoods and places are written, at 11 px or more and a contrast of 4.5:1 or more in
both themes (`quietBaseMap`). `addBuildings` raises the buildings for the 3D views.

The MapLibre module worker is imported through Vite (`?worker&url`) and registered explicitly.
Its default relative URL is not copied automatically into a bundled application. Both Explore
and trip maps use this configuration.
