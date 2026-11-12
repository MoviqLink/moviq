import {
  agentRulesSchema,
  weeklyHoursSchema,
  type AgentTalk,
  type AgentRules,
  type WeeklyHours,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { TokenBudget } from '../assistant/budget.js';
import type { LanguageModel, ModelStep, ToolSpec } from '../assistant/model/language-model.js';
import { findPersonalData, scrubPersonalData } from '../assistant/privacy.js';
import type { CommerceDependencies } from './context.js';
import { merchantRequests } from './merchant-board.js';
import { merchantStore, type Merchant } from './merchants.js';
import { checkRulesChange } from './rules-update.js';

/** What the model said: words, a change of rules it wants proposed, or nothing usable. */
type TalkReply =
  | { readonly kind: 'words'; readonly text: string }
  | {
      readonly kind: 'change';
      readonly rules: AgentRules;
      readonly hours: WeeklyHours | undefined;
      readonly explanation: string;
    }
  | { readonly kind: 'none' };

/** The merchant's agent in conversation with its merchant, on the language model. */
export interface MerchantTalk {
  answer(input: {
    readonly context: string;
    readonly message: string;
    readonly language: 'en' | 'es';
  }): Promise<TalkReply>;
}

const INSTRUCTIONS = [
  'You are the AI agent of a demo merchant on MovIQ, talking with the merchant who owns you.',
  'Answer only from the context: your rules, opening hours (New York time), menu, MovIQ minimum',
  'reward and the recent checks in which the server refused your offers, with their reasons.',
  'Explain refusals by those reasons. When the merchant asks to change a rule or the hours, call',
  'propose_rules once with the complete new rules (and the complete hours if they change) and a',
  'short explanation of its effect on the next offers; never claim it is saved: the merchant',
  'confirms it. You never move money: refunds of missing lines are made in Scan and payouts in',
  'Payouts; say so when asked. Answer in at most three short sentences, in the language given.',
].join(' ');

const proposalArguments = z.strictObject({
  rules: agentRulesSchema,
  hours: weeklyHoursSchema.optional(),
  explanation: z.string().min(1).max(400),
});

const { $schema, ...parameters } = z.toJSONSchema(proposalArguments);

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'propose_rules',
    description: 'Proposes new rules for the merchant to confirm. Nothing is saved by calling it.',
    parameters,
  },
];

function fromStep(step: ModelStep, logger: Logger): TalkReply {
  if (!step.ok) {
    logger.info('merchant talk had no usable answer', { reason: step.reason });
    return { kind: 'none' };
  }
  if (step.kind === 'text') return { kind: 'words', text: step.text.trim().slice(0, 1200) };
  const [call] = step.calls;
  const parsed = proposalArguments.safeParse(call?.arguments);
  if (step.calls.length !== 1 || call?.name !== 'propose_rules' || !parsed.success) {
    logger.info('merchant talk asked for a tool that does not fit');
    return { kind: 'none' };
  }
  const { rules, hours, explanation } = parsed.data;
  return { kind: 'change', rules, hours, explanation };
}

/** The agent's talk on Sara's model interface and daily budget. */
export function modelTalk(deps: {
  readonly model: LanguageModel;
  readonly budget: TokenBudget;
  readonly logger: Logger;
}): MerchantTalk {
  return {
    answer: async ({ context, message, language }) => {
      const reservation = await deps.budget.reserve(deps.model.maxTokensPerStep);
      if (reservation === undefined) return { kind: 'none' };
      let used: number | null = null;
      try {
        const exchange = deps.model.open({
          instructions: `${INSTRUCTIONS} Language: ${language === 'es' ? 'Spanish' : 'English'}.`,
          context,
          message,
          tools: TOOLS,
        });
        const step = await exchange.step([]);
        used = step.usage?.totalTokens ?? null;
        return fromStep(step, deps.logger);
      } finally {
        await deps.budget.settle(reservation, used);
      }
    },
  };
}

const RECENT_REFUSALS = 5;

/** What the agent knows: its setup and its offers the server refused lately, with no alias. */
async function contextFor(deps: CommerceDependencies, merchant: Merchant): Promise<string> {
  const setup = await merchantStore.setup(deps.db, merchant);
  const requests = await merchantRequests(deps, merchant.summary.id);
  const refused = requests.flatMap((request) =>
    request.conversation.flatMap((entry) =>
      entry.message.type === 'check' && entry.message.verdict === 'rejected'
        ? [{ at: entry.at, craving: request.craving, refusals: entry.message.refusals }]
        : [],
    ),
  );
  return JSON.stringify({
    merchant: { name: merchant.summary.name, kind: merchant.summary.kind },
    minRewardPercent: deps.settings.minRewardPercent,
    rules: setup.rules,
    hours: setup.hours,
    version: setup.rulesVersion,
    menu: setup.menu.map((item) => ({
      id: item.id,
      name: item.name,
      priceMinor: item.priceMinor,
      canLeaveOut: item.ingredients.filter((i) => i.removable).map((i) => i.name),
      canAdd: item.extras.map((extra) => extra.name),
    })),
    recentRefusals: refused.slice(-RECENT_REFUSALS),
  });
}

/**
 * The merchant writes to its agent. Without a model the panel is told to use the form. A change
 * the agent wants is checked exactly as saving checks it and comes back as a proposal on the
 * current version; nothing is saved here.
 */
export async function talkToAgent(
  deps: CommerceDependencies,
  merchant: Merchant,
  input: { readonly message: string; readonly language: 'en' | 'es' },
): Promise<AgentTalk> {
  if (deps.talk === undefined) return { mode: 'off' };
  const context = await contextFor(deps, merchant);
  const message = scrubPersonalData(input.message);
  if (findPersonalData([context]) !== undefined) return { mode: 'unavailable' };
  const reply = await deps.talk.answer({ context, message, language: input.language });
  if (reply.kind === 'none') return { mode: 'unavailable' };
  if (reply.kind === 'words') {
    return { mode: 'answer', reply: reply.text, proposal: null, refused: null };
  }
  const checked = await checkRulesChange(deps, merchant, reply);
  if (!checked.ok) {
    return { mode: 'answer', reply: reply.explanation, proposal: null, refused: checked.message };
  }
  const { rulesVersion } = await merchantStore.setup(deps.db, merchant);
  return {
    mode: 'answer',
    reply: reply.explanation,
    proposal: { rules: reply.rules, hours: checked.hours, version: rulesVersion },
    refused: null,
  };
}
