# triplog

The traveller's history and plans, two screens of the dashboard tabs.

- `MyTripsScreen.tsx`: figures of the month (from `sampleStats()`), the live trips started in this
  browser (`home/trips`, read only) and the trip history in the shared `DataGrid`.
- `CalendarScreen.tsx`: the current month as a CSS grid, Monday to Sunday, with each day's trips
  (scheduled ones in the accent colour, today marked; the next month too when a scheduled trip
  falls in it) and the list of scheduled trips beside it.
- `parts.tsx`: line badges, the sample notice, the screen heading and money and time formats.
- `sample.ts`: the hand-written sample history. Every block that shows it carries `SAMPLE_NOTICE`.
- `triplog.css`: styles, on the tokens of `shared/styles/tokens.css`.

Each screen is a `<main id="main">` without a top bar: the dashboard container draws it.
