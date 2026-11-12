# The trip

`#/trip/<id>`, rendered with the id as its key, so nothing of one trip survives into another. The
map is the stage (MapLibre with OpenFreeMap's free tiles and its attribution); over it float the
panel with the arrival, the watch's verdict, the live connection and the steps, Sara's options
and the timeline of plan against expectation. On a phone the panel is a bottom sheet.

- `TripScreen.tsx`: the layout for desktop and phone.
- `api.ts`: the journey, its events URL and the payment endpoints, validated against the contracts.
- `live/`: the journey as the server has it, by request and by Server-Sent Events.
- `model/`: the expected arrival, the margins and the timeline, as pure functions.
- `map/`: the map, its style, the route layers and the stop markers.
- `payment/`: paying an alternative with PayPal's web SDK (v6).
- `ui/`: the pieces of the screen.
- `sara-texts.ts`, `model/sara.ts`, `live/useSaraWords.ts`, `ui/SaraSays.tsx` and
  `ui/AskSara.tsx`: Sara's words on the latest change (written by the server once per change,
  with a discreet line of sources), the watch's own sentence and why when there are none, and a
  field to ask her about the trip; an option she proposes is selected with its PayPal button. The
  question carries the alias and tastes of this device (`rewards/`), so a craving goes to the demo
  merchants on the way; the need she opens shows under her card (`rewards/RewardsOnTheWay.tsx`).
- `texts.ts`: English and Spanish, with the same keys; `flight-words.ts`, the flight's statuses
  and sources in both; `step-free-texts.ts`, the step-free section in both.
- `ui/RestroomsOnTheWay.tsx`, `live/useRestrooms.ts`, `model/restrooms.ts` and `restroom-texts.ts`:
  "Restroom on the way", beside the rewards while the trip is watched: the free public restrooms in
  service nearest to the next stops (`GET /api/city/restrooms`, the city's list only), by stop on
  the route line, the distance said as a straight line, the hours as published and never "open
  now"; on a step-free trip the fully accessible ones first, and said. Asked again only when a
  leg ends or the trip changes.
- `ui/StepFree.tsx` and `model/step-free.ts`: a step-free trip as the MTA lists say it now, one
  sentence (clear with the time of the outages, broken at a station, not confirmed, not checkable,
  or never checked), each platform on the route line, what is not verified, and why no step-free
  alternative could be looked for.

Rules: the screen never declares a payment by itself (only `captured` from the server's
confirmation counts); a lost connection says since when and retries for real; Sara's thinking bar
fills once in about 4 s; nothing moves in a loop.

Tested in `apps/web/tests` (`live-feed`, `payment-flow`, `journey-model`, `map-geometry`,
`flight-panel`, `step-free`, `restrooms`).
