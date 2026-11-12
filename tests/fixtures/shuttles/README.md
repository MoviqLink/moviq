# Shuttle captures

Taken on 11/11/2026 (22:20 in New York) with the generic browser `User-Agent`, one request per
file, without a key, cookie or special header. All files are whole.

- `jfk-lga-shuttle-positions.pb`:
  `https://passio3.com/jfkpanynj/passioTransit/gtfs/realtime/vehiclePositions` at 03:20:01 UTC;
  10 buses, header 03:20:01.
- `ewr-shuttle-positions.pb`:
  `https://passio3.com/ewrpanynj/passioTransit/gtfs/realtime/vehiclePositions` at 03:20:04 UTC;
  17 buses, header 03:20:05.
- `passio-go-buses.json`: `https://passiogo.com/mapGetData.php?getBuses=2&json=…` at 03:22:15 UTC,
  with `json` set to `{"s0":"1007","s1":"7073","s2":"1569","s3":"5082","s4":"466","sA":5}`; 6
  buses (NYU 5, LIU 1). The Downtown Connection, Hutch Metro Center and Hoboken had no bus in
  service at that hour. Re-indented by Prettier.

`ewr-shuttle-gtfs.zip` is the public Newark GTFS from `https://passio3.com/ewrpanynj/passioTransit/gtfs/google_transit.zip`; its trips and shapes are tested against the captured vehicle positions.

`passio-go-routes.json` captures the public map’s route points for the five systems already served by the shuttle feed.
