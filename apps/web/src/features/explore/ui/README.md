# Explore UI

- `VehicleCard.tsx`: the card cloned from Vektia's: identity and destination, origin of the
  position, then `VehicleBlocks.tsx` (signal and margin, speed and course on a compass), the
  block of its mode and, at the foot, coordinates and source.
- `ServiceBlock.tsx`: stops ahead, destination, delay and the possible stoppage with its evidence.
- `CraftBlocks.tsx`: an aircraft (callsign, altitude, usual route), a ship (type, MMSI, declared
  destination) and a shuttle (operator, route, people on board).
- `StationCard.tsx` and `PlaceBodies.tsx`: an airport with its FAA programs, a bike station, a
  PATH station with its next trains, a scooter or bike parked.
- `YourMap.tsx` and `LineSearch.tsx`: search, add and remove lines; source state and age;
  explicit other transport and city layers. `CityNow.tsx`: before any choice, one card per mode
  with what is followed in the city, its state and the age of its data. `Overview.tsx` remains for specialised views.
- `ModePanel.tsx`: one row per mode with its count, state and filter.
- `SourceCredit.tsx`: the source at a card's foot: title, credit with its addresses as links, and
  the age of its data or, for a timetable, «in force, published on» its day.
- `Nearby.tsx`: the vehicles nearest the middle of the map, reachable with the keyboard.
- `LayerSwitch.tsx`: 2D or aerial, moved with the arrow keys.
- `Gauges.tsx`: the compass, the signal bars and the margin icon.
