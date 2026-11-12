# Planning

| File                | Responsibility                                                                          |
| ------------------- | --------------------------------------------------------------------------------------- |
| `state.ts`          | The conversation state (draft, last question, places offered, an hour said alone, plan) |
| `actions.ts`        | Find and choose places, set the arrival, plan once complete                             |
| `flight-actions.ts` | Find a flight; without AeroDataBox's answer, fill it from the boarding pass             |
| `tool.ts`           | `defineTool`: a tool's JSON schema from its Zod schema, and the call validated with it  |
| `model-tools.ts`    | The tools offered to the model: five of planning, five of the city, two of rewards      |
| `instructions.ts`   | Sara's instructions and the draft as the model reads it: names and New York times only  |
| `ai-turn.ts`        | The model's turn: budget hold before each call, privacy check, reply checks             |
| `basic-turn.ts`     | The basic turn: a city question, or the reader's parts through the same actions         |
| `replies.ts`        | Fixed replies in English and Spanish, each fact said once, then the one open question   |
| `flight-replies.ts` | What Sara says of a flight found, read from a boarding pass or not found                |
| `words.ts`          | Times and days as Sara writes them in each language                                     |

A flight sets the destination (its airport, as the geocoder knows it) and the time: be at the
airport `AIRPORT_MARGIN_MINUTES` (120, `journeys/flight-deadline.ts`) before the revised
departure, or the scheduled one without it. When AeroDataBox is down, out of units or does not
know the flight, Sara asks for the departure time on the boarding pass and its airport (and the
terminal if known); the flight is then marked `boarding-pass` and the watch checks it. The plan uses public modes, a 15-minute
walk at most and 5 minutes to spare until travellers can set their own preferences.

Tested in `tests/assistant/turns.test.ts`, `ai-mode.test.ts`, `guards.test.ts` and
`boarding-pass.test.ts`.

A generic airport is clarified before searching. A likely JFK typo is confirmed before it is
resolved; a geocoder no-match is reported separately from an unavailable provider.
