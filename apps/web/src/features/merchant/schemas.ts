import type {
  agentSetupSchema,
  AgentPreview,
  AgentProposal,
  AgentTalk,
  AgentRules,
  kitchenTicketSchema,
  MerchantSummary,
  merchantRequestSchema,
  merchantTodaySchema,
  payoutBoardSchema,
  payoutViewSchema,
  refundAnswerSchema,
  scanAnswerSchema,
  ScanRefusal,
  ScanRefusalReason,
  Weekday,
  WeeklyHours,
} from '@moviq/contracts';

/**
 * The types of the answers of `/api/merchant` the screens read. The schemas live in
 * `@moviq/contracts` (`merchant.ts`), where the server builds them; `api.ts` validates every
 * answer against them, so these are only what a valid answer holds.
 */
type Parsed<S extends { parse(input: unknown): unknown }> = ReturnType<S['parse']>;

export type DemoMerchant = MerchantSummary;
export type MerchantToday = Parsed<typeof merchantTodaySchema>;
export type MerchantRequest = Parsed<typeof merchantRequestSchema>;
export type KitchenTicket = Parsed<typeof kitchenTicketSchema>;
export type PayoutView = Parsed<typeof payoutViewSchema>;
export type PayoutBoard = Parsed<typeof payoutBoardSchema>;
export type OrderStatus = KitchenTicket['status'];
export type AgentSetup = Parsed<typeof agentSetupSchema>;
export type MenuItem = AgentSetup['menu'][number];
export type ScanAnswer = Parsed<typeof scanAnswerSchema>;
export type RefundAnswer = Parsed<typeof refundAnswerSchema>;
export type PreviewCase = AgentPreview['cases'][number];
export type {
  AgentPreview,
  AgentProposal,
  AgentRules,
  AgentTalk,
  ScanRefusal,
  ScanRefusalReason,
  Weekday,
  WeeklyHours,
};
