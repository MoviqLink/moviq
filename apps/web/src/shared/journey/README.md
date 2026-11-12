# Journey pieces

Shared by the planner and the trip:

- `LegRail.tsx`: the steps on the route line, each time with how it is known (live with its age,
  timetable or estimated) and the source on hover; an arrival that moved shows the planned one
  struck.
- `CityTime.tsx`: a New York time with tabular figures and the period set smaller.
- `timing.ts`: leaving is timed by the first vehicle and arriving by the last.
- `order.ts`: the recommended itinerary or alternative first.
- `walks.ts`: how a walk is known (on the streets, a station's time, estimated, or a change not
  checked) and whether an itinerary is provisional; a leg kept before the labels is estimated.
- `rides.ts`: what an itinerary rides, named in MovIQ's style, never with official symbols.
- `money.ts`: an amount set by the server, in the reader's language.
- `texts.ts`: words for modes and times in English and Spanish.
- `journey.css`: the route colours (teal, amber risk, indigo alternatives, red late) and the rail.
