# Explore city layers

What the data platform gathers about the city, in Explore's panel and on its map, grouped as
Transport (the transit alerts, under the modes), Street, Useful places, Harbor and Weather. Each
layer turns on and off with its count of the whole city and its state; only incidents are on
when Explore opens, and only the layers on are asked of `GET /api/city/layers`, as the modes are.
A layer without data says "No data now", never zero.

| Folder or file          | Contents                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| `api.ts`                | The layers in the box, the parking signs of a tile and a camera's still   |
| `useCityLayers.ts`      | The layers on, read once a minute and on each move; the signs near by     |
| `useRadar.ts`           | NOAA's radar mosaic: off at first, asked again every two minutes while on |
| `model/`                | Which layers are asked, what is drawn or listed, and the panel's notes    |
| `ui/`                   | `CityPanel`, its rows and the card of each kind of item                   |
| `texts*.ts`, `texts.ts` | English and Spanish words, with the same keys                             |
| `city.css`              | The styles of the city layers only                                        |

What the screen promises and what it does not:

- A camera's picture comes from MovIQ's server (`/api/city/cameras/<id>/image`), never from the
  camera's owner, with its time and whether that time is the camera's or the moment MovIQ got
  it. It is asked when the card opens, on "Refresh" and once a minute, and replaces the last one
  in place, with no fade. The live video plays only after "Watch video"; where the browser plays
  no HLS, the card offers the official address instead. Nothing installs a player.
- A street permit is a window in which work is allowed: counted by borough, never drawn, never a
  closure. Chargers are a list, never free or in use; a meter's "Active" is the meter; a parking
  sign keeps its text and is never read as "allowed now"; subway entrances are the 2024 survey.
- Parking meters wait for a few streets in view, and parking signs for a tile of 1,000 feet.
- The radar tiles are asked by the browser from NOAA, as the base map is asked from OpenFreeMap,
  and swapped without a fade.
