# Credits

`#/credits` and `#/creditos`, linked from the foot of every page. Every source MovIQ uses, grouped
by what it gives, each with the credit its licence asks for, word for word, and the licence, plus
the notice NYC DOT asks every application to carry.

- `sources.ts`: the credits in their order, and the notice of NYC DOT. The server has no public
  list of sources with their licences yet, so the page does not ask it.
- `credit.ts`: what a credit holds. Each one lists the catalogue sources it covers and the files
  of the repository it is taken from (`docs/data-sources.md` for the catalogue; the on-demand
  providers, the map and the photo from their own files).
- `groups-moving.ts` (transit, bikes, flights, the harbor) and `groups-city.ts` (streets, weather,
  events, maps and pictures): the credits themselves.
- `texts.ts`: names and what each source gives, in English and Spanish. Credit lines and licence
  names stay in English, as their holders write them.
- `CreditsScreen.tsx`, `credits.css`: the page.

Tested in `apps/web/tests/credits.test.ts`: every source of the catalogue is credited once, every
credit line of the catalogue appears word for word, and every file cited exists.
