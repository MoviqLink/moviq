# Amtrak source

One definition, `amtraker-new-york`, exported in `amtrakSources` from `index.ts`. No key.

Amtraker (`https://api-v3.amtraker.com/v3/trains`) is an independent API, unrelated to Amtrak,
that reads the official Amtrak map and gives every train with its GPS position, speed, heading,
origin, destination and the station it is at or heading to. Only Amtrak trains inside the
approaches of Penn Station are kept (40.2 to 41.3 N, 74.8 to 73.3 W: Trenton, Peekskill,
Stamford); the others, and VIA Rail and Brightline trains, are counted. Trains waiting to depart
have no position of their own and no `updatedAt`, so they are counted apart, not placed.

- The time of the data is the newest `updatedAt` of an Amtrak train: Amtraker refreshes them in
  batches (71 seconds old on 11/11/2026, 2 to 3 minutes in two earlier samples). Each train keeps
  `lastValTS`, when Amtrak received its position. `hot`: every 2 minutes, every minute with an
  interest.
- An empty area is valid at night; an answer without any Amtrak train is refused.

Licence: ODC-By 1.0 (stated in the README of the `amtrak` package on npm). The credit to
Amtraker, with a link to https://amtraker.com, must be prominent where the trains appear.
Amtraker asks for a User-Agent that names the project; MovIQ sends the generic browser identity
of all its requests, which Amtraker answers.

Tests: `apps/server/tests/sources/amtrak/`, against the capture in `tests/fixtures/amtrak/`.
