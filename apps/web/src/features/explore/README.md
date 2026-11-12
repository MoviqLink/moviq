# Explore

`ExploreScreen` starts with the city now: every subway train, regional train, ferry and shuttle
followed, and the PATH stations, with one card per mode counting what is followed and the age of
its data; buses, over two thousand, are added by route. The traveller searches the compact line
catalogue, adds lines by mode and source, or explicitly enables other transport and city layers;
then the selected lines alone are read inside the map bounds. A vehicle opens its card and verified route; selecting
a specialised view such as traffic or stations applies its own layers and restores the previous
choices on return. 2D and aerial views share the same selection.

| Folder or file                     | Contents                                                             |
| ---------------------------------- | -------------------------------------------------------------------- |
| `api.ts`                           | `/api/live/vehicles` (box, modes and lines) and `/api/live/interest` |
| `live/`                            | Reading the live city every 15 s, one request at a time              |
| `map/`                             | The MapLibre map, its views, the marks and their single move         |
| `model/`                           | Pure rules of the cards and of the vehicles shown                    |
| `ui/`                              | The panel, the mode list, the layer switch and the cards             |
| `events/`                          | The events layer: today, tonight or this weekend, and its card       |
| `city/`                            | The city layers by group, their cards and a camera's picture         |
| `texts*.ts`                        | English and Spanish words, with the same keys                        |
| `explore.css`, `explore-modes.css` | The styles of this screen only                                       |
