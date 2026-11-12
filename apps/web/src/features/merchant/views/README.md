# Merchant panel: screens

One screen per section of the panel; `Screen.tsx` picks it from the address.

| File                                                 | Screen                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `TodayView.tsx`                                      | Today: what was charged and the pickups on their way            |
| `RequestsView.tsx`                                   | Requests: each need, its offer and the conversation             |
| `TicketsView.tsx`, `ticket-columns.tsx`              | Kitchen tickets in AG Grid, moved forward by the kitchen        |
| `ScanView.tsx`                                       | The pickup code, the charge as the server answered, and refunds |
| `CustomersView.tsx`                                  | Customers in AG Grid: alias and what matters for the menu       |
| `PayoutsView.tsx`, `payout-columns.ts`               | Payouts: account, "get paid now", refunds to deduct and batches |
| `AgentView.tsx`, `AgentForm.tsx`, `AgentKitchen.tsx` | "Your agent": the rules and what the kitchen allows             |
| `AgentHours.tsx`, `useAgentDraft.ts`                 | The opening hours by day, and the rules and hours saved at once |
| `AgentPreview.tsx`                                   | What the rules compose now for three example customers          |
| `AgentTalk.tsx`                                      | The talk with the agent and the change it proposes              |

Tested in `apps/web/tests/merchant/views.test.ts` and end to end in `tests/e2e/merchant.spec.ts`.
