# Explore live data

`useLineCatalog` reads the compact `/api/live/lines` catalogue every 30 seconds. `useLineSelection`
keeps the person's choices only for the current screen. `useLiveCity` reads selected lines and
other explicitly enabled modes in the visible box every 15 seconds; with nothing chosen,
`useShownCity` reads the city now (`CITY_MODES`: trains, ferries, shuttles and PATH stations). Specialised views retain their own filters.

`poll.ts` runs one request at a time, pauses and aborts while hidden, and cancels on view changes.
