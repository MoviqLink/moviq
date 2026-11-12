# Trip pieces

`WatchSummary` (the arrival as the one big number, the margin and the watch's verdict with its
evidence), `LiveLine` (live, or lost since when, with a real reconnect), `FlightPanel` (the
flight's scheduled and revised times, terminal, gate and status, each with its source, the
departure the plan uses, where sources disagree, and AeroDataBox's credit), `Incidents` (what was
observed, its impact and its source with its age), `SaraCard` and `Alternatives` (a native radio
group, recommended first; a priced option is paid with PayPal, a free one is taken with
`UseRoute`, which posts to `…/alternatives/:id/apply` and shows the journey the server returns), `Timeline`, `Sheet` (the bottom sheet on a phone), `TripNotice`
(opening, not found, or why it did not load), `SaraSays` (Sara's words with their sources and
time, the watch's own sentence and why, or that she is watching; they appear once and stay
still), `AskSara` (a question about the trip; a proposed option is selected in the card) and
`RestroomsOnTheWay` (the public restrooms near the next stops, by stop on the route line, with
the straight line, access, a key or code and the hours as published, and the list's source and
age) and `useThinking` (options that arrive live wait
for Sara's bar to fill once, about 4 s, and stay off the map until then).
