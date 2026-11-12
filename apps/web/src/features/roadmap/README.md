# Roadmap

The trip as a timeline: each leg (walk, subway, bus, rail, ferry, transfer) is a bar from its
start to its end on New York's clock, chained to the next one by an arrow, with the kind of leg,
its line, where it goes and its minutes in a table beside it. Drawn with Bryntum Gantt Community
(`@bryntum/gantt-react-community`, MIT), read only.

## Where the data comes from

- `roadmapFromItinerary(itinerary, lang?)`: an itinerary of `POST /api/plan`, leg by leg, with the
  times its sources gave. A walk between two rides is shown as a transfer.
- `roadmapFromSample(trip, today?, lang?)`: a sample trip of `features/triplog/sample.ts`. It keeps
  only lines and planned minutes, so the rides share that time evenly with a 3-minute transfer
  between two of them; the stations of a change are named by the change of line, never invented.

## Files

```
TripRoadmap.tsx     the component; loads Bryntum's styles, so import it with lazy()
roadmap-chart.ts    legs → rows and arrows, columns, time axis and the read-only configuration
from-itinerary.ts   itinerary or sample trip → RoadmapLeg[]
roadmap-text.ts     RoadmapLeg and every word shown, in English and Spanish
ny-time.ts          New York wall clock ↔ instant
roadmap.css         Bryntum's Svalbard theme in MovIQ's tokens, light and dark; one colour per mode
```

## Notes

- The chart draws in the browser's zone, so it is given New York's wall clock: the hours are New
  York's wherever the page is opened.
- Bryntum Community has no time ranges: "now" is a layer of its own, shown only while the trip
  is under way, and placed again every 30 seconds in a single step.
- Below 640 px the line and route columns are left to the bar and its tooltip, and the time axis
  scrolls sideways inside its frame.
