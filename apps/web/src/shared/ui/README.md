# UI

`Logo.tsx` (the lime ring and MOVIQ, and the ring's arcs for the intro), `Icon.tsx` (one family of
1.75 px stroke icons), `DataGrid.tsx` (AG Grid Community drawn with the page tokens, sized to its
rows, without animations), `useMediaQuery.ts`, and for the traveller's screens:

- `TopBar.tsx`: the logo to the home page, the navigation, appearance and language; solid on a
  page, floating over a map or lying on the home page's photo. Its skip link moves the focus,
  never the address.
- `TravellerNav.tsx`: Sara, Explore and My trips. In the header from 720 px; below, docked at the
  foot of the screen, which takes `--dock-h` from the bottom for panels and pages.
- `SiteFooter.tsx`: what MovIQ is, and the link to the credits.
- `ThinkingBar.tsx`: Sara thinking, a bar that fills once in about 4 s.

Styled in `traveller.css` and `nav.css`.
