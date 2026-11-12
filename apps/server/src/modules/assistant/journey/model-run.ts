import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import type { TokenBudget } from '../budget.js';
import type {
  LanguageModel,
  ModelRequest,
  ModelStep,
  ToolCall,
  ToolResult,
} from '../model/language-model.js';
import type { BasicReason } from '../planning/replies.js';
import { findPersonalData } from '../privacy.js';

export interface ModelRunDependencies {
  readonly model: LanguageModel;
  readonly budget: TokenBudget;
  readonly logger: Logger;
}

/** The model's words with every tool answer it read, or why Sara says the fixed words instead. */
export type ModelRun =
  | { readonly kind: 'words'; readonly text: string; readonly outputs: readonly string[] }
  | { readonly kind: 'fallback'; readonly reason: BasicReason };

type ToolRunner = (calls: readonly ToolCall[]) => Promise<ToolResult[]>;

/**
 * One exchange with the model about a trip: today's budget holds the most each step can use
 * before it is sent, and everything about to leave is checked for personal data first. It never
 * takes more than `maxSteps` steps; without a runner, a request for tools is not a valid answer.
 */
export async function runModel(
  deps: ModelRunDependencies,
  request: ModelRequest,
  options: {
    readonly maxSteps: number;
    readonly runTools?: ToolRunner;
    readonly signal?: AbortSignal;
  },
): Promise<ModelRun> {
  if (blocked(deps, [request.context, request.message])) {
    return { kind: 'fallback', reason: 'privacy' };
  }
  const exchange = deps.model.open(request);
  const outputs: string[] = [];
  let results: ToolResult[] = [];
  for (let step = 0; step < options.maxSteps; step += 1) {
    const reservation = await deps.budget.reserve(deps.model.maxTokensPerStep);
    if (reservation === undefined) return { kind: 'fallback', reason: 'budget' };
    let answer: ModelStep | undefined;
    try {
      answer = await exchange.step(results, options.signal);
    } finally {
      await deps.budget.settle(reservation, answer?.usage?.totalTokens ?? null);
    }
    if (!answer.ok) {
      deps.logger.warn('sara trip model step failed', {
        reason: answer.reason,
        detail: answer.detail,
      });
      return { kind: 'fallback', reason: 'model-failed' };
    }
    if (answer.kind === 'text') return { kind: 'words', text: answer.text, outputs };
    if (options.runTools === undefined) {
      deps.logger.warn('sara trip model asked for tools it was not given');
      return { kind: 'fallback', reason: 'model-failed' };
    }
    results = await options.runTools(answer.calls);
    const said = results.map((result) => result.output);
    if (blocked(deps, said)) return { kind: 'fallback', reason: 'privacy' };
    outputs.push(...said);
  }
  deps.logger.warn('sara trip model used every step without answering');
  return { kind: 'fallback', reason: 'model-failed' };
}

function blocked(deps: ModelRunDependencies, texts: readonly string[]): boolean {
  const kind = findPersonalData(texts);
  if (kind === undefined) return false;
  deps.logger.warn('sara trip message blocked before leaving', { kind });
  return true;
}
