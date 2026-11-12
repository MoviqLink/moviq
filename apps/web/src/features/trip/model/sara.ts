import type { Journey } from '@moviq/contracts';

import type { Lang } from '../../../shared/i18n/lang';

type Explanation = NonNullable<Journey['watch']['explanation']>;

/**
 * What Sara's card says about the trip:
 * - `quiet`: nothing changed that needs telling, so Sara says she is watching;
 * - `writing`: a change is there and her words on it are on their way;
 * - `ai`: her words, written by the model from the journey's facts, with their sources;
 * - `basic`: the watch's own sentence, and why there are no words of hers.
 */
export type SaraWords =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'writing' }
  | ({ readonly kind: 'ai' } & Omit<Extract<Explanation, { mode: 'ai' }>, 'mode'>)
  | {
      readonly kind: 'basic';
      readonly reason: BasicReason;
      readonly evidence: string;
    };

/** Why there are no words of Sara's: the server's reasons, or `unreached` when none arrived. */
export type BasicReason = Extract<Explanation, { mode: 'basic' }>['reason'] | 'unreached';

/** A change Sara explains: a verdict at risk or late, an incident, or options on offer. */
function hasChange(journey: Journey): boolean {
  const { status } = journey.watch;
  return (
    journey.state === 'watching' &&
    (status === 'at-risk' ||
      status === 'late' ||
      journey.incidents.length > 0 ||
      journey.alternatives.length > 0)
  );
}

/** Whether Sara's words in this language are missing for the change the journey shows. */
export function needsWords(journey: Journey, lang: Lang): boolean {
  return hasChange(journey) && journey.watch.explanation?.lang !== lang;
}

/** The words for the card, in the traveller's language. */
export function saraWords(journey: Journey, lang: Lang): SaraWords {
  if (!hasChange(journey)) return { kind: 'quiet' };
  const explanation = journey.watch.explanation;
  if (explanation?.lang !== lang) return { kind: 'writing' };
  if (explanation.mode === 'basic') {
    return { kind: 'basic', reason: explanation.reason, evidence: journey.watch.evidence };
  }
  const { mode, ...words } = explanation;
  return { kind: mode, ...words };
}

/** The watch's own sentence in place of words that did not arrive for this change. */
export function unreached(journey: Journey): SaraWords {
  return { kind: 'basic', reason: 'unreached', evidence: journey.watch.evidence };
}

/** Changes when what Sara explains changes, so her words are asked for once per change. */
export function changeKey(journey: Journey, lang: Lang): string {
  const ids = (items: readonly { readonly id: string }[]) => items.map((item) => item.id).join(',');
  return [
    journey.state,
    journey.watch.status,
    ids(journey.incidents),
    ids(journey.alternatives),
    lang,
  ].join('|');
}
