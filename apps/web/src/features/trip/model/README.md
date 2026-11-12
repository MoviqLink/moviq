# Trip model

- `projection.ts`: the arrival the server projected from live data (`watch.projectedArriveAt`)
  and the margin it leaves before the deadline, rounded down. Without a projection (not worked out
  yet, a missed transfer or a leg without data) the plan's arrival is shown, from the timetable;
  the web never estimates it by itself.
- `timeline.ts`: each leg as planned on one axis, with round-minute ticks, the deadline and the
  projected arrival.
- `sara.ts`: what Sara's card says (watching, writing, her words, or the watch's own sentence and
  why), whether a change still needs her words, and the key that changes once per change.
- `restrooms.ts`: the next stops a restroom is looked for near (shared with Sara through the
  contracts), the query that asks for them, the answer by stop and the published hours on one line.
- `flight.ts`: the flight's facts (scheduled and revised times, terminal, gate, status or movement),
  each from the newest source that gives it, AeroDataBox before the boarding pass.
