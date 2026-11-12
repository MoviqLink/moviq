# Live journey

- `feed.ts`: follows the journey's Server-Sent Events. Each event is unnamed, carries the
  journey's version as its id and a full snapshot validated against `journeySchema`; one outside
  the contract is refused and counted. The `: keepalive` comments never reach the page. Every drop closes the
  stream, says since when it is lost and opens a new one after 2, 5, 10, 20 and then 30 s;
  `reconnect` opens one at once.
- `useJourney.ts`: asks for the journey once, then follows the feed; a not-found journey stops it.
  "Reconnect now" asks the server again and opens a new stream. `replace` shows a journey the
  server answered with directly, such as after taking an alternative.
- `useRestrooms.ts`: the public restrooms near the next stops, asked once per set of stops; after a
  failure, again only when the traveller asks.
- `useSaraWords.ts`: when a change has no words of Sara's in the language in use, asks the server
  once for that change; the words arrive by the stream, or in its answer when the stream is late.
