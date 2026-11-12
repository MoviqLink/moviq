# Merchant panel tests

| File              | Covers                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `model.test.ts`   | The conversation as steps, the ticket's next step, customers' tags and the rules form          |
| `api.test.ts`     | Each endpoint against its contract, `PUT` included, and answers outside it refused             |
| `views.test.ts`   | The screens drawn from answers: requests, tickets, scan results, payouts and refunds to deduct |
| `texts.test.ts`   | The same keys in English and Spanish                                                           |
| `agent.test.ts`   | Opening hours checked and drawn, the preview of example offers, scan refusals read as answers  |
| `talk.test.ts`    | The talk with the agent: a proposal's changes, the panel without the AI model, the request     |
| `conversation.ts` | A sample conversation between Sara and a merchant's agent, written for the tests               |
