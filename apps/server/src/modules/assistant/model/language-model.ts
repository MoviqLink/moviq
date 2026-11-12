/**
 * What the assistants need from a language model, whoever provides it: read instructions and a
 * message, ask for tools with typed arguments, and answer in words. An adapter validates every
 * answer against its own schema and reports one that does not fit as `rejected`; it never adapts
 * it. Only adapters talk to a provider.
 */

/** A tool the model may ask for. `parameters` is a strict JSON Schema object. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  /** The arguments as the model wrote them: unknown until the tool's own schema accepts them. */
  readonly arguments: unknown;
}

export interface ToolResult {
  readonly callId: string;
  /** What the tool answered, as JSON text. */
  readonly output: string;
}

export interface ModelRequest {
  readonly instructions: string;
  /** What MovIQ already knows (the draft of the trip), sent with developer authority. */
  readonly context: string;
  /** The traveller's words, already stripped of personal data. */
  readonly message: string;
  readonly tools: readonly ToolSpec[];
}

/** Tokens a step used as the provider counted them; null when its answer could not be read. */
export type StepUsage = { readonly totalTokens: number } | null;

export type ModelStep =
  | {
      readonly ok: true;
      readonly kind: 'calls';
      readonly calls: readonly ToolCall[];
      readonly usage: StepUsage;
    }
  | { readonly ok: true; readonly kind: 'text'; readonly text: string; readonly usage: StepUsage }
  | {
      readonly ok: false;
      /**
       * `unavailable`: no answer (network, timeout, provider error); `rate_limited`: the provider
       * asked to slow down or the quota is spent; `misconfigured`: the key or the model is not
       * accepted; `rejected`: an answer arrived but did not fit its schema, was cut short or
       * was a refusal.
       */
      readonly reason: 'unavailable' | 'rate_limited' | 'misconfigured' | 'rejected';
      /** One plain sentence for the logs, never the content of the conversation. */
      readonly detail: string;
      readonly usage: StepUsage;
    };

/** One exchange with the model: the request, then as many rounds of tool results as needed. */
export interface ModelExchange {
  /** The first step takes no results; each later one takes the results of the calls asked for. */
  step(results: readonly ToolResult[], signal?: AbortSignal): Promise<ModelStep>;
}

export interface LanguageModel {
  /** The provider's model name, for the control room. */
  readonly model: string;
  /** The most tokens one step can use, so the daily budget is reserved before each call. */
  readonly maxTokensPerStep: number;
  open(request: ModelRequest): ModelExchange;
}
