import { z } from 'zod';

import {
  findRewards,
  REWARD_TOOLS,
  runRewardTool,
  type FoundRewards,
} from '../../commerce/sara-tools.js';
import type { ToolCall, ToolResult } from '../model/language-model.js';
import type { PlanningPorts } from '../planning/actions.js';
import type { BasicReason } from '../planning/replies.js';
import type { Lang } from '../planning/state.js';
import { readCraving } from '../understanding/craving.js';

/** The need Sara passed to the merchants this turn, and its offers by the number the model reads. */
export interface RewardsSeen {
  needId: string | null;
  offerIds: readonly string[];
}

const REWARD_NAMES = new Set(REWARD_TOOLS.map((tool) => tool.name));

export const isRewardCall = (call: ToolCall): boolean => REWARD_NAMES.has(call.name);

const foundSchema = z.looseObject({
  need_id: z.string().min(1),
  offers: z.array(z.looseObject({ offer_id: z.string() })),
});
const reserveSchema = z.strictObject({ offer_id: z.string().regex(/^[1-9]$/) });

const said = (call: ToolCall, value: unknown): ToolResult => ({
  callId: call.callId,
  output: JSON.stringify(value),
});

/**
 * Runs one of the reward tools for the model. Ids never reach it (the privacy check refuses
 * them): it reads the offers by number, and `reserve_offer` takes that number.
 */
export async function runRewardCall(
  call: ToolCall,
  ports: PlanningPorts,
  seen: RewardsSeen,
): Promise<ToolResult> {
  const ctx = ports.rewards;
  if (ctx === undefined) {
    return said(call, { error: 'Rewards need the tastes of this device: ask on the trip screen.' });
  }
  if (call.name === 'reserve_offer') {
    const parsed = reserveSchema.safeParse(call.arguments);
    const offerId = parsed.success ? seen.offerIds[Number(parsed.data.offer_id) - 1] : undefined;
    if (offerId === undefined) {
      return said(call, { error: 'Pass the number of an offer find_rewards gave this turn.' });
    }
    return runRewardTool({ ...call, arguments: { offer_id: offerId } }, ctx);
  }
  const result = await runRewardTool(call, ctx);
  const found = foundSchema.safeParse(JSON.parse(result.output));
  if (!found.success) return result;
  const { need_id: needId, offers, ...rest } = found.data;
  seen.needId = needId;
  seen.offerIds = offers.map((offer) => offer.offer_id);
  const numbered = offers.map(({ offer_id: _id, ...offer }, index) => ({
    number: index + 1,
    ...offer,
  }));
  return said(call, { ...rest, offers: numbered });
}

const words = (lang: Lang) => (en: string, es: string) => (lang === 'es' ? es : en);

/** Why Sara answers a craving with fixed words, said first. */
function fixedNotice(reason: BasicReason, lang: Lang): string {
  const say = words(lang);
  const fixed = say('so I answer with fixed words.', 'así que te respondo con frases fijas.');
  switch (reason) {
    case 'no-model':
      return `${say('My AI is not connected,', 'Mi IA no está conectada,')} ${fixed}`;
    case 'budget':
      return `${say("Today's AI allowance is used up,", 'Hoy ya se ha gastado el uso de IA previsto,')} ${fixed}`;
    case 'model-failed': {
      const lead = say(
        'My AI did not give an answer I can stand behind,',
        'Mi IA no ha dado una respuesta que pueda respaldar,',
      );
      return `${lead} ${fixed}`;
    }
    case 'privacy': {
      const lead = say(
        'So that nothing personal is sent to my AI,',
        'Para que no se envíe nada personal a mi IA,',
      );
      return `${lead} ${fixed}`;
    }
  }
}

/** What Sara says, with fixed words, of what the demo merchants on the way answered. */
function foundSentence(found: FoundRewards, craving: string, lang: Lang): string {
  const say = words(lang);
  if (!found.ok) {
    return say(
      `I could not ask the merchants on your way: ${found.error}`,
      `No he podido preguntar a los comercios de tu camino. El servidor dice, en inglés: «${found.error}»`,
    );
  }
  const asked = say(
    `I passed “${craving}” to the demo merchants on your way.`,
    `He pasado «${craving}» a los comercios de ejemplo de tu camino.`,
  );
  const best = found.offers.find((offer) => offer.recommended) ?? found.offers[0];
  if (best !== undefined) {
    const count = found.offers.length;
    return [
      asked,
      say(
        `${count === 1 ? 'One offer' : `${String(count)} offers`}; I recommend ${best.merchant} at ` +
          `${best.stop}: you pay ${best.pays} and earn ${best.earns}, ready at ${best.pickup_at}.`,
        `${count === 1 ? 'Una oferta' : `${String(count)} ofertas`}; te recomiendo ${best.merchant} en ` +
          `${best.stop}: pagas ${best.pays} y ganas ${best.earns}, listo a las ${best.pickup_at}.`,
      ),
      say(
        'Reserve it below with PayPal: it is only held, and charged when you collect it.',
        'Resérvala abajo con PayPal: solo se retiene, y se cobra cuando la recoges.',
      ),
    ].join(' ');
  }
  if (found.questions.length > 0) {
    const ask = say(
      'A merchant asks you something first: answer it below.',
      'Un comercio te pregunta algo antes: contéstalo abajo.',
    );
    return `${asked} ${ask}`;
  }
  return `${asked} ${say('None of them can make it for you right now.', 'Ninguno puede preparártelo ahora.')}`;
}

/**
 * The basic reader's way to the rewards: a sentence that says a craving ("me apetece ramen")
 * goes to the merchants on the way, and Sara tells what they answered with fixed words.
 * Undefined when the sentence says none, or this device sent no tastes.
 */
export async function basicRewards(
  ports: PlanningPorts,
  input: { readonly lang: Lang; readonly reason: BasicReason; readonly message: string },
): Promise<{ readonly sentence: string; readonly needId: string | null } | undefined> {
  const { lang, reason, message } = input;
  const craving = readCraving(message);
  if (craving === undefined || ports.rewards === undefined) return undefined;
  const found = await findRewards(ports.rewards, craving);
  const sentence = `${fixedNotice(reason, lang)} ${foundSentence(found, craving, lang)}`;
  return { sentence, needId: found.ok ? found.needId : null };
}
