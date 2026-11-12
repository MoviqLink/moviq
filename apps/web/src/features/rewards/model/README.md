# Rewards: models

Pure rules, with no React and no requests.

| File              | What it decides                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `need.ts`         | The offers in order (Sara's recommendation, then the largest reward), a merchant's question in the reader's language, why there is no offer, and when cancelling is free |
| `server-words.ts` | The server's refusals in English as written and in Spanish; an unknown one is shown as written                                                                           |
| `shopper.ts`      | The alias and tastes kept on this device, checked against the contract                                                                                                   |

Tested in `apps/web/tests/rewards.test.ts`.
