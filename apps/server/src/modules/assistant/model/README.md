# Language model

`language-model.ts` is what the assistants need from any model: an exchange of steps in which the
model either asks for tools (with arguments still `unknown` until each tool's schema accepts
them) or answers in words. Failures say why: `unavailable`, `rate_limited`, `misconfigured` or
`rejected` (an answer that does not fit, was cut short or was a refusal).

`openai.ts` is the only code that talks to OpenAI, through the official SDK and the Responses API,
which OpenAI recommends for new projects and which its current models need for tool calling
(<https://developers.openai.com/api/docs/guides/migrate-to-responses>,
<https://developers.openai.com/api/docs/guides/function-calling>). Tools are declared with
`strict: true`; a request with no tools sends no tool fields. Requests are stateless (`store: false`); within one exchange, tool calls and
encrypted reasoning go back with the results, as the function-calling guide asks. The SDK's
machine headers (`x-stainless-*`) are removed and the generic network identity is sent instead.

The default model is `gpt-6-luna`, which OpenAI lists as its most efficient model for focused,
high-volume tasks (<https://developers.openai.com/api/docs/models>,
<https://developers.openai.com/api/docs/models/gpt-6-luna>); `OPENAI_MODEL` overrides it.
`openai-schema.ts` validates every answer with Zod against the documented shape
(<https://developers.openai.com/api/reference/resources/responses/methods/create>).

Tested in `tests/assistant/openai.test.ts` against a local server answering with the reference's
own examples (`tests/fixtures/openai/`).
