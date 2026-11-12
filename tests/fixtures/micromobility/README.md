# Micromobility captures

Taken on 11/11/2026 between 03:20:44 and 03:20:56 UTC (22:20 in New York) with the generic
browser `User-Agent`, one request per file, without a key.

- `lime-new-york.json`: `https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status`;
  8 of 5,291 vehicles.
- `veo-bronx.json`: `https://cluster-prod.veoride.com/api/shares/name/nyc/gbfs/free_bike_status`;
  12 of 1,337.
- `veo-queens.json`: `https://cluster-prod.veoride.com/api/shares/name/nyq/gbfs/free_bike_status`;
  10 of 1,315.
- `bird-new-york.json`: `https://mds.bird.co/gbfs/v2/public/new-york/free_bike_status.json`; 9 of 890.

Cut by whole rows, in their order, envelope unchanged: the first eight vehicles, the first
disabled one, the first reserved one and the first of each vehicle type. Re-indented by Prettier.
