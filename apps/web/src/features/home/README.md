# Home

The traveller's own place: How it works, Sara's field and My trips.

- `HomeScreen.tsx`: `#/how-it-works`. Who Sara is, her four steps (where and when, the plan, the
  watch and the new plan, the tickets with PayPal), what stays in your hands, and the way in:
  Start leads to `#/agents`, and the city live to `#/explore`.
- `AskSara.tsx`: Sara's field, on the panel. Enter sends; Shift and Enter starts a new line.
- `intro/`: the opening moment, once per session.
- `trips/`: `#/trips`, the trips started in this browser.
- `photo/`: the home page photo, in three sizes.
- `texts.ts`: English and Spanish, with the same keys.

Tested in `apps/web/tests/intro.test.ts`, `saved-trips.test.ts` and `traveller-i18n.test.ts`.
