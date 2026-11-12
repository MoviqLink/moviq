# Sara on the trip

What Sara says about a trip under watch, with the language model when there is one.

| File              | Responsibility                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `facts.ts`        | The journey as the model reads it: verdict, steps, incidents, options, prices, NY times  |
| `instructions.ts` | Sara's instructions to explain a change and to answer a question about the trip          |
| `model-run.ts`    | One bounded exchange: budget held before each step, personal data blocked before leaving |
| `checks.ts`       | Words kept only if every price, clock time and number came from the facts or the tools   |
| `explain.ts`      | Sara's words on the latest change, written once per change and kept in the journey       |
| `propose.ts`      | `propose_alternative`: an option on offer, priced by the server's purchase catalogue     |
| `ask.ts`          | A question about the trip: the city tools and `propose_alternative`; fixed words without |
| `trip-turn.ts`    | The question as a turn of the conversation; the draft being planned stays as it was      |
| `rewards.ts`      | The reward tools for the model, offers by number; a craving in basic mode, fixed words   |
| `words.ts`        | The fixed words in English and Spanish: why, the watch's own sentence, the proposal      |

## Explaining a change

`POST /api/assistant/journeys/:id/explanation` (the trip screen asks when a change has no words
in its language yet). A change is the verdict, the incidents by id and the options by their
rides and whether they cost money (`journeys/explanation.ts`); on track with nothing else there is
nothing to explain. The model gets one step, no tools and only the facts: public stops and
stations by name, lines, New York times, figures and the server's prices. Addresses, device
positions and coordinates are never sent. The words are kept as `watch.explanation` with the
sources of the facts, so the live stream brings them to every open screen; asking again for the
same change calls nobody, and two requests at once share one call. Without the model, without
today's allowance, with words the checks refuse or with something personal, `watch.explanation`
is `basic` with its reason, and the screen shows the watch's own sentence and says why. The watch
keeps the words only while the change they explain is still the journey's.

## Questions and paying from Sara

`POST /api/assistant/turns` with a `journeyId`. `propose_alternative` takes an option by its
number in the facts. A free one is taken with "Use this route"; one with a price is quoted by
`journeyPurchases`, the catalogue `payments/` creates the PayPal order with, so the price Sara
says is the server's. The answer carries `proposal`; the screen selects that option with its
official PayPal button. Nothing is charged or applied until the traveller approves in PayPal and
PayPal confirms the capture.

## Rewards on the way

With the alias and tastes the device sends (`shopper`), Sara may pass a craving ("me apetece un
ramen") to the demo merchants on the trip: `find_rewards` and `reserve_offer` from
`commerce/sara-tools.ts`. The alias and tastes are only used for the need message, never sent to
the model; the model reads each offer by its number, with prices and pickup times written as Sara
says them, and no id (the privacy check refuses them). Without the model, the basic reader
(`understanding/craving.ts`) finds the craving and Sara tells the recommended offer with fixed
words, saying first that she answers with fixed words. The answer carries `rewards.needId`; the
screen shows the questions and the offers, reserved with PayPal's button. Without `shopper`, no
merchant is asked.

Tested in `tests/assistant/trip-explanation.test.ts`, `trip-questions.test.ts`, `trip-rewards.test.ts`,
`sara-rewards-flow.test.ts`, in
`tests/journeys-watch-explanation.test.ts` and, with a real key, in
`tests/live/sara-trip.live.test.ts`.
