import type { Journey } from '@moviq/contracts';

import type { PurchaseCatalog } from '../../payments/catalog.js';
import type { TokenBudget } from '../budget.js';
import { askCity } from '../city/ask.js';
import { cityTools } from '../city/tools.js';
import { citySentences } from '../city/words.js';
import type { LanguageModel, ToolCall, ToolResult } from '../model/language-model.js';
import { REWARD_TOOLS } from '../../commerce/sara-tools.js';
import type { PlanningPorts } from '../planning/actions.js';
import type { BasicReason } from '../planning/replies.js';
import type { Turn } from '../planning/state.js';
import type { AssistantTool } from '../planning/tool.js';
import { readCityQuestion } from '../understanding/city-question.js';
import { wordsProblem } from './checks.js';
import { journeyFacts } from './facts.js';
import { questionInstructions } from './instructions.js';
import { runModel } from './model-run.js';
import { proposeTool, type Proposal } from './propose.js';
import { basicRewards, isRewardCall, runRewardCall, type RewardsSeen } from './rewards.js';
import { proposalSentence, tripBasicNotice, watchSentence } from './words.js';

export interface AskDependencies {
  readonly model: LanguageModel | undefined;
  readonly budget: TokenBudget;
  readonly catalog: PurchaseCatalog;
}

/** What Sara answered about the trip, with the city answers and the option she proposed. */
export interface TripAnswer {
  readonly mode: 'ai' | 'basic';
  readonly reply: string;
  readonly proposal: Proposal | null;
  /** The need Sara passed to the merchants on the way, whose offers the screen shows. */
  readonly needId: string | null;
}

/** One request and up to two rounds of tools, so an answer stays within a few seconds. */
const MAX_STEPS = 3;

/**
 * A question about the trip under watch. The model reads the journey's facts and may use the
 * city tools and `propose_alternative`; its words are kept only if every price, time and number
 * came from the facts, the tools or the question. With this device's tastes, she can also pass a
 * craving to the demo merchants on the way. Without the model, a city question or a craving is
 * still answered by the basic reader, and the rest gets the watch's own sentence.
 */
export async function askAboutJourney(
  deps: AskDependencies,
  ports: PlanningPorts,
  turn: Turn,
  input: { readonly journey: Journey; readonly message: string },
): Promise<TripAnswer> {
  const { journey, message } = input;
  if (deps.model === undefined) return basicAnswer(ports, turn, journey, message, 'no-model');
  const facts = journeyFacts(journey, turn.lang, turn.now);
  const proposals: Proposal[] = [];
  const seen: RewardsSeen = { needId: null, offerIds: [] };
  const tools = [
    ...cityTools,
    proposeTool({
      journey,
      travellerId: turn.travellerId,
      catalog: deps.catalog,
      lang: turn.lang,
      proposals,
    }),
  ];
  const run = await runModel(
    { model: deps.model, budget: deps.budget, logger: ports.logger },
    {
      instructions: questionInstructions(turn.lang),
      context: facts.context,
      message,
      tools: [
        ...tools.map((tool) => tool.spec),
        ...(ports.rewards === undefined ? [] : REWARD_TOOLS),
      ],
    },
    {
      maxSteps: MAX_STEPS,
      runTools: (calls) => runCalls(tools, calls, ports, turn, seen),
      ...(turn.signal === undefined ? {} : { signal: turn.signal }),
    },
  );
  if (run.kind === 'fallback') return basicAnswer(ports, turn, journey, message, run.reason);
  const proposal = proposals.at(-1) ?? null;
  const given = [facts.context, message, ...run.outputs];
  const problem = wordsProblem(run.text.trim(), turn.lang, given);
  const { needId } = seen;
  if (problem === undefined) return { mode: 'ai', reply: run.text.trim(), proposal, needId };
  ports.logger.warn('sara trip words replaced by the fixed words', { problem });
  const fixed =
    proposal === null ? watchSentence(journey, turn.lang) : proposalSentence(proposal, turn.lang);
  const city = citySentences(turn.city, turn.lang, turn.now);
  const reply = [tripBasicNotice('model-failed', turn.lang), ...city, fixed].join(' ');
  return { mode: 'ai', reply, proposal, needId };
}

async function basicAnswer(
  ports: PlanningPorts,
  turn: Turn,
  journey: Journey,
  message: string,
  reason: BasicReason,
): Promise<TripAnswer> {
  const question = readCityQuestion(message, turn.now);
  if (question !== undefined && turn.city.length === 0) await askCity(ports, turn, question);
  const city = citySentences(turn.city, turn.lang, turn.now);
  const sentences = [tripBasicNotice(reason, turn.lang), ...city];
  const rewards =
    city.length === 0 ? await basicRewards(ports, { lang: turn.lang, reason, message }) : undefined;
  if (rewards !== undefined) {
    return { mode: 'basic', reply: rewards.sentence, proposal: null, needId: rewards.needId };
  }
  if (city.length === 0) sentences.push(watchSentence(journey, turn.lang));
  return { mode: 'basic', reply: sentences.join(' '), proposal: null, needId: null };
}

/** Runs the calls in order, each validated by its own tool; a call that does not fit is refused. */
async function runCalls(
  tools: readonly AssistantTool[],
  calls: readonly ToolCall[],
  ports: PlanningPorts,
  turn: Turn,
  seen: RewardsSeen,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) {
    if (isRewardCall(call)) {
      results.push(await runRewardCall(call, ports, seen));
      continue;
    }
    const tool = tools.find((candidate) => candidate.spec.name === call.name);
    const outcome = tool === undefined ? undefined : await tool.run(call.arguments, ports, turn);
    if (outcome?.ok !== true) {
      ports.logger.warn('sara trip tool call rejected', { tool: call.name.slice(0, 64) });
    }
    const output =
      outcome === undefined
        ? { rejected: 'There is no tool with that name.' }
        : outcome.ok
          ? outcome.answer
          : { rejected: 'The arguments do not match the schema.', issues: outcome.issues };
    results.push({ callId: call.callId, output: JSON.stringify(output) });
  }
  return results;
}
