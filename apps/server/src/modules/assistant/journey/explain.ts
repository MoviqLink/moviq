import { toInstant, type Journey } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { Database } from '../../../infrastructure/database/database.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import { explanationSubject, type WatchExplanation } from '../../journeys/explanation.js';
import { journeyStore } from '../../journeys/journey-store.js';
import type { TokenBudget } from '../budget.js';
import type { LanguageModel } from '../model/language-model.js';
import type { BasicReason } from '../planning/replies.js';
import type { Lang } from '../planning/state.js';
import { wordsProblem } from './checks.js';
import { journeyFacts } from './facts.js';
import { explainInstructions } from './instructions.js';
import { runModel } from './model-run.js';

export interface ExplainDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly model: LanguageModel | undefined;
  readonly budget: TokenBudget;
}

export interface JourneyExplainer {
  /**
   * The traveller's journey with Sara's words on its latest change, written now if they are not
   * there yet in that language; undefined when the journey is not theirs.
   */
  explain(
    journeyId: string,
    travellerId: string,
    lang: Lang,
    logger: Logger,
  ): Promise<Journey | undefined>;
}

const ASK = {
  en: 'Explain what changed on my trip.',
  es: 'Explícame qué ha cambiado en mi viaje.',
} as const;

/**
 * Sara's words on a trip, written once per change: the model reads only the journey's facts, a
 * single step with no tools, and its words are kept only if every price, time and number in
 * them came from those facts. They are kept in the journey, so the live stream delivers them to
 * every open screen. Two requests for the same change share one call to the model.
 */
export function createJourneyExplainer(deps: ExplainDependencies): JourneyExplainer {
  const writing = new Map<string, Promise<void>>();
  return {
    async explain(journeyId, travellerId, lang, logger) {
      const stored = await journeyStore.get(deps.db, journeyId);
      if (stored?.travellerId !== travellerId) return undefined;
      const about = explanationSubject(stored.journey);
      const current = stored.journey.watch.explanation;
      if (about === null || (current?.about === about && current.lang === lang)) {
        return stored.journey;
      }
      const key = `${journeyId}|${about}|${lang}`;
      let running = writing.get(key);
      if (running === undefined) {
        running = compose(deps, stored.journey, about, lang, logger)
          .then((explanation) => save(deps, journeyId, explanation, logger))
          .finally(() => writing.delete(key));
        writing.set(key, running);
      }
      await running;
      return (await journeyStore.get(deps.db, journeyId))?.journey;
    },
  };
}

async function compose(
  deps: ExplainDependencies,
  journey: Journey,
  about: string,
  lang: Lang,
  logger: Logger,
): Promise<WatchExplanation> {
  const basic = (reason: BasicReason): WatchExplanation => ({ mode: 'basic', about, lang, reason });
  if (deps.model === undefined) return basic('no-model');
  const now = deps.clock.now();
  const facts = journeyFacts(journey, lang, now);
  const run = await runModel(
    { model: deps.model, budget: deps.budget, logger },
    {
      instructions: explainInstructions(lang),
      context: facts.context,
      message: ASK[lang],
      tools: [],
    },
    { maxSteps: 1 },
  );
  if (run.kind === 'fallback') return basic(run.reason);
  const text = run.text.trim();
  const problem = wordsProblem(text, lang, [facts.context]);
  if (problem !== undefined) {
    logger.warn('sara trip words replaced by the fixed words', { problem });
    return basic('model-failed');
  }
  return { mode: 'ai', about, lang, text, writtenAt: toInstant(now), sources: [...facts.sources] };
}

/** Keeps the words while the journey still says what they explain; retried once on a race. */
async function save(
  deps: ExplainDependencies,
  journeyId: string,
  explanation: WatchExplanation,
  logger: Logger,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const stored = await journeyStore.get(deps.db, journeyId);
    if (stored === undefined || explanationSubject(stored.journey) !== explanation.about) return;
    const now = deps.clock.now();
    const watch = { ...stored.journey.watch, explanation };
    const saved = await deps.db.transaction(async (tx) => {
      const updated = await journeyStore.update(tx, journeyId, stored.version, { watch }, now);
      if (updated) {
        const detail = { mode: explanation.mode, lang: explanation.lang };
        await journeyStore.addEvent(tx, journeyId, 'sara-explained', detail, now);
      }
      return updated;
    });
    if (saved) return;
  }
  logger.info('sara trip words not kept: the journey changed meanwhile', { journey: journeyId });
}
