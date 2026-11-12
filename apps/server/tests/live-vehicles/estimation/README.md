# Position estimator tests

| File                     | Covers                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `kalman.test.ts`         | The 1-D Kalman filter along the route, against values worked out by hand           |
| `gps-plus.test.ts`       | Buses between two GPS signals: never backwards, stops, impossible jumps            |
| `run-time.test.ts`       | Trains between stations: the median given «not arrived yet», and a possible stall  |
| `estimator.test.ts`      | The choice of label (GPS, GPS+, predicted) and margin, and forgetting a vehicle    |
| `statistics.test.ts`     | The checks on the recorder's answers through the statistics port                   |
| `captures.test.ts`       | Real captures of buses and trains                                                  |
| `recorded-keys.test.ts`  | The keys the estimator asks with against the events the recorder writes            |
| `recorded.test.ts`       | The estimator fed by the recorder's database: margin, stall, sign, under 20        |
| `recorded-cache.test.ts` | Reading in the background without making a build wait; the feed of each route      |
| `recorded-gps.test.ts`   | Typical speed and `gps-plus` margin from a reduced bus day; Cloudflare's day       |
| `replay.test.ts`         | The recorder's replay finds the error the estimator itself makes, report by report |

`lines.ts` and `statistics.ts` are shared helpers: hand-made lines and a recorder double.
