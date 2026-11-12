# 511NY source tests

| File                   | Covers                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `event-layers.test.ts` | The seven event layers: cut to the city area, text without markup, times, minimums |
| `layers.test.ts`       | Road conditions, message signs (clock ahead), cameras (addresses only), crossings  |
| `captures.ts`          | Reading captures of `tests/fixtures/`, and the `Date` of each 511NY answer         |

The captures are in `tests/fixtures/ny511/`; `captures.ts` is shared with the street tests.
