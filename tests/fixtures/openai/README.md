# OpenAI

Answers of the Responses API (`POST /v1/responses`) for the adapter tests. MovIQ never calls
OpenAI from a test, and these are not captures of its own traffic: each body is the data of an
example in OpenAI's API reference, unchanged, only laid out by the formatter,
<https://developers.openai.com/api/reference/resources/responses/methods/create> (Markdown at the
same address with `.md`), downloaded on 11 November 2026.

| File                 | Example in the reference                              | Used to check                               |
| -------------------- | ----------------------------------------------------- | ------------------------------------------- |
| `function-call.json` | "Functions", response example (`get_current_weather`) | A tool call and its arguments, read as JSON |
| `text.json`          | "Text input", response example                        | A text answer and its token usage           |
| `full-response.json` | "Example", `200` example with every documented field  | Fields MovIQ does not read are ignored      |

Answers that must be rejected (an unknown output item, a cut-short answer, an error status) are
written inside the tests themselves, next to the case they prove.
