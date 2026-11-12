import type { NeedMessage, ProtocolMessage } from '@moviq/contracts';

import type { MerchantAgentSetup } from './merchants.js';

/** What a merchant's agent knows when it is its turn in a conversation. */
export interface AgentTurn {
  readonly need: NeedMessage;
  readonly setup: MerchantAgentSetup;
  /** The conversation so far, the server's checks and Sara's answers included. */
  readonly history: readonly ProtocolMessage[];
  readonly minRewardPercent: number;
  /** Now plus the kitchen's preparation time. */
  readonly earliestPickup: Date;
  readonly clarificationsLeft: number;
}

/**
 * A merchant's agent: it reads the turn and writes its next message, which the server treats as
 * untrusted input (`unknown`) and validates against the protocol before anything else. `null`
 * means it has nothing to offer. It can neither charge nor change an amount: it only proposes.
 */
export interface MerchantAgent {
  respond(turn: AgentTurn): Promise<AgentReply>;
}

export interface AgentReply {
  readonly message: unknown;
  /** Who composed it: the language model, or the merchant's rules when the model is not used. */
  readonly composer: 'model' | 'rules';
}
