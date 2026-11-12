# Planning with Sara

`#/` and `#/plan`. The person writes; Sara answers, asks only for what is missing and, once she
has the origin, the destination and the time to arrive, shows the ways there with the recommended
one first. "Start this trip" creates the journey on the server from the plan's id and the
itinerary's id, and opens `#/trip/<id>`. A question about the city ("how is the A?") is answered
with a card under Sara's words, with the sources and the time of their data.

- `PlanScreen.tsx`: the transcript, the composer and what Sara understood.
- `api.ts`: `POST /api/assistant/turns` and `POST /api/journeys`, validated against the contracts.
- `useConversation.ts`: the conversation of the visit, kept while the person goes to a trip and back.
- `model/`: the conversation as pure steps and the store that sends them.
- `ui/`: the pieces of the screen.
- `texts.ts`: English and Spanish, with the same keys.

Tested in `apps/web/tests/conversation.test.ts`, `city-answer.test.ts` and `traveller-i18n.test.ts`.
