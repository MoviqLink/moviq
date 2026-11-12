# App

- `routes.ts`: `#/` is the welcome page after traveller entry (otherwise the selector), `#/access` selects a profile, `#/plan` the conversation, `#/trip/<id>` a trip,
  `#/trips` My trips, `#/rewards` the rewards on the way and My orders, `#/explore` the city live,
  `#/credits` and `#/creditos` the credits, `#/ops/…` the control room and `#/merchant/…` the demo
  merchants' panel; anything else is not found.
- `screens.ts`: every screen but the home page, loaded only when its address is opened
  (`React.lazy`), so the first load carries neither the maps (MapLibre) nor the grids (AG Grid).
  On a slow 4G phone the home page is usable in 3.0 s instead of 14.1 s (11/11/2026).
- `App.tsx`: opens the area of the address (with one quiet "Loading…" line while its code
  arrives), with the trip keyed by its id so nothing of one trip
  survives into another; names the browser tab; puts the foot with the credits under the pages
  (not under the full-screen maps); lets the first address decide whether the intro plays; and
  keeps every trip opened for My trips.
- `useAskSara.ts`: the home page's first words go to the one conversation with Sara, which goes
  on at `#/plan`.
- `ErrorBoundary.tsx`: a screen that fails while drawing shows a plain message with a reload
  button instead of a blank page.
