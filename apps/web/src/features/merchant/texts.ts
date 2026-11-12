import { useLang } from '../../shared/i18n/lang';
import { agentEn } from './agent-en';
import { agentEs } from './agent-es';
import { deskEn } from './desk-en';
import { deskEs } from './desk-es';
import { talkEn } from './talk-en';
import { talkEs } from './talk-es';
import { panelEn } from './texts-en';
import { panelEs } from './texts-es';

// The merchant panel's words, in parts of one size each. Spanish has exactly the same keys:
// TypeScript and the tests check it. What the server or an agent wrote (a refusal's detail, an
// agent's question) is shown as it came, marked as English.
export const merchantEn = { ...panelEn, conversation: talkEn, ...deskEn, ...agentEn };

export type MerchantDict = typeof merchantEn;

export const merchantEs: MerchantDict = { ...panelEs, conversation: talkEs, ...deskEs, ...agentEs };

/** The merchant panel's words in the language in use. */
export function useMerchantT(): MerchantDict {
  return useLang() === 'es' ? merchantEs : merchantEn;
}
