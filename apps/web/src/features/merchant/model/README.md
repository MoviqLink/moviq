# Merchant panel: models

Pure rules, with no React and no requests.

| File              | What it decides                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `conversation.ts` | Each protocol message as a step on the line between Sara and the merchant's agent               |
| `counter.ts`      | The next step of a kitchen ticket; collecting is only by scanning, which charges                |
| `customers.ts`    | Each customer's latest need, and the tags of it that matter for the menu                        |
| `problem.ts`      | A failed request said plainly: what happened, what to do and the server's reference             |
| `rules.ts`        | The numeric rules of "Your agent" as the form edits them, checked against the program's minimum |
| `hours.ts`        | The opening hours as the form edits them, checked with the contract's rule                      |
| `proposal.ts`     | What a change the agent proposes would change, line by line                                     |

Tested in `apps/web/tests/merchant/model.test.ts`, `agent.test.ts` and `talk.test.ts`.
