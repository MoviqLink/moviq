# Assistant

Sara for planning: the traveller says where they are going and when they must be there (or which
flight they must catch), in English or Spanish. Sara asks only for what is missing and, once she
has the destination, the time and the start, hands over the plan of the `JourneyPlanner`. Places
come from the `Geocoder`, flights from the `FlightFinder` and plans from the planner, all injected
(`journeys/ports.ts`); Sara never fills a slot herself, and when a port cannot answer she says so.

| File / folder      | Responsibility                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| `routes.ts`        | `POST /assistant/turns` and `…/journeys/:id/explanation` (under `/api`), per traveller |
| `sara.ts`          | One turn: load the conversation, understand, plan when complete, reply, save           |
| `conversations.ts` | Conversations per traveller, holding only the draft, expiring after 30 idle minutes    |
| `budget.ts`        | The shared daily token budget and `assistantUsageToday` for the control room           |
| `privacy.ts`       | Strips personal data from the message and blocks anything personal before it leaves    |
| `model/`           | The language model interface and its OpenAI adapter                                    |
| `planning/`        | The draft, the actions both modes share, the model's tools and the fixed replies       |
| `understanding/`   | The basic reader: times, days and flight numbers as people write them                  |
| `city/`            | Answers about the city: lines, incidents, vehicles, stations, the recorder's figures   |
| `journey/`         | Sara on a trip under watch: her words on each change, questions, paying from Sara      |

## Two modes, both honest

- **`ai`**: a language model reads the message and uses the tools. Its tool calls are validated
  with each tool's schema and its answers with the provider's schema; anything that does not fit
  is rejected, never adapted. A reply that names a clock time no source gave this turn is
  replaced by the fixed reply. The plan's times are always the planner's.
- **`basic`**: without `OPENAI_API_KEY`, once today's budget is spent, when the model gives no
  valid answer, or when something personal would have been sent, the deterministic reader fills
  the same slots with the same actions. The reply says it is in basic mode, and why.

## The city

Sara also answers "how is the A?", "¿hay incidencias en el 7?", "where is my bus?", "¿funciona el
ascensor de 59 St?", "how is PATH?", "¿hay avisos en el ferri?" and "is the 7 usually on time at
this hour?", from the data platform only (`city/README.md`). Every figure, time and state comes
from a tool with its source and the time of its data, which the turn carries in `city` for the
screen; a source that cannot be read is said, never taken for "no incidents". With the model, its
words are kept only if every number in them came from a tool or the traveller this turn. These
questions leave the trip being planned as it was.

## The trip

On a trip under watch, Sara explains each change in her own words, from the journey's facts
alone, once per change, and answers questions about it, proposing an option to take or to pay
with PayPal at the server's price, and passes a craving to the demo merchants on the way, whose
validated offers are reserved with PayPal (`journey/README.md`). While planning, the reward tools
answer that rewards come with a trip under watch.

## Daily budget

`ASSISTANT_DAILY_TOKEN_BUDGET` tokens per New York day, shared by every traveller and counted in
`assistant_token_usage`. Before each model call the most it can use is held; after it, the hold
becomes what the provider counted. A call that never answers keeps its hold, so the budget is
never exceeded, even with several processes. `assistantUsageToday` gives the day's use for the
control room.

## Privacy

MovIQ uses the OpenAI API with data sharing turned on. **With data sharing, OpenAI may use what
is sent to train its models.** So only what is needed to understand the request is sent: the
traveller's message with contact details, ticket and booking details and names removed, and the
draft of the trip as place names and New York times. Never the traveller id, the conversation id,
saved addresses, coordinates or any profile data; no `user`, `safety_identifier` or `metadata`
field. Responses are not stored at OpenAI (`store: false`). Everything about to leave is checked
again and blocked, with a log line naming only the kind of data, if anything personal remains.
The conversation kept by MovIQ holds the draft, never the traveller's words.

Tested in `tests/assistant/` and, with a real key, in `tests/live/openai.live.test.ts`.
