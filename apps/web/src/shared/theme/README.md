# Theme

`theme.ts` keeps the choice (light, dark or automatic, saved in the browser) and sets
`data-theme` on the document; automatic leaves it off so the stylesheet follows the system.
`ThemeSwitch.tsx` offers the three choices. `useDarkTheme.ts` says whether the page is dark now,
chosen or inherited from the system, for pieces drawn outside the stylesheet such as the map.
