# Merchant panel: pieces

| File               | What it draws                                                                        |
| ------------------ | ------------------------------------------------------------------------------------ |
| `Shell.tsx`        | The frame: logo, the merchant marked demo, its sections, theme, language, exit       |
| `Head.tsx`         | A screen's title, its lead and when its data was received                            |
| `SignIn.tsx`       | The demo merchants to enter as, with their stop and buses                            |
| `Loaded.tsx`       | A screen's data while loading, after a problem, or ready                             |
| `ProblemNote.tsx`  | What went wrong and what to do, with the server's reference                          |
| `Conversation.tsx` | The conversation between Sara and the merchant's agent, message by message           |
| `OfferSummary.tsx` | The offer the server accepted with its reward, or why there is none                  |
| `Camera.tsx`       | The pickup code read by the camera, where the browser has `BarcodeDetector`          |
| `Refund.tsx`       | The lines of a collected order, to refund the missing ones                           |
| `ToDeduct.tsx`     | Refunds the merchant bears that no payout has deducted yet, only when there are some |

Tested in `apps/web/tests/merchant/views.test.ts`.
