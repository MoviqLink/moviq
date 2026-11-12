import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

import type { AppConfig } from '../../../config/config.js';
import type { Secret } from '../../../config/secret.js';
import { GENERIC_BROWSER_HEADERS } from '../../../infrastructure/http/client.js';
import type {
  LanguageModel,
  ModelExchange,
  ModelRequest,
  ModelStep,
  StepUsage,
  ToolCall,
  ToolResult,
} from './language-model.js';
import {
  responseSchema,
  usageOnlySchema,
  type OpenAIResponse,
  type OutputItem,
} from './openai-schema.js';

/**
 * The OpenAI adapter, on the Responses API, which OpenAI recommends for new projects and which
 * its current models need for tool calling. `gpt-6-luna` is the model OpenAI lists for
 * cost-sensitive, high-volume work. Nothing is stored at OpenAI (`store: false`), and no field
 * that identifies a person (`user`, `safety_identifier`, `metadata`) is ever sent.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

const API_BASE = 'https://api.openai.com/v1';
const MAX_OUTPUT_TOKENS = 1_200;
/** Instructions, tools, the draft, the message and a few tool results fit well within this. */
const MAX_INPUT_TOKENS = 6_800;
const TIMEOUT_MS = 30_000;

interface OpenAIModelOptions {
  readonly apiKey: Secret;
  readonly model?: string | undefined;
  /** Tests only: a local origin standing in for api.openai.com, as `TEST_PROVIDER_ORIGIN`. */
  readonly testOrigin?: string | undefined;
  readonly fetch?: typeof fetch;
}

/** The model of the configuration, or undefined when `OPENAI_API_KEY` is not set. */
export function openAIModelFromConfig(config: AppConfig): LanguageModel | undefined {
  const openai = config.integrations.find((integration) => integration.id === 'openai');
  if (openai?.state !== 'configured') return undefined;
  return createOpenAIModel({
    apiKey: openai.credentials.OPENAI_API_KEY,
    model: config.assistant.model,
    testOrigin: config.testProviderOrigin,
  });
}

export function createOpenAIModel(options: OpenAIModelOptions): LanguageModel {
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const client = new OpenAI({
    apiKey: options.apiKey.reveal(),
    organization: null,
    project: null,
    baseURL:
      options.testOrigin === undefined ? API_BASE : `${options.testOrigin}/api.openai.com/v1`,
    timeout: TIMEOUT_MS,
    maxRetries: 1,
    fetch: genericIdentity(options.fetch ?? fetch),
    logLevel: 'off',
  });
  return {
    model,
    maxTokensPerStep: MAX_INPUT_TOKENS + MAX_OUTPUT_TOKENS,
    open: (request) => openExchange(client, model, request),
  };
}

function openExchange(client: OpenAI, model: string, request: ModelRequest): ModelExchange {
  const input: ResponseInputItem[] = [
    { role: 'developer', content: request.context },
    { role: 'user', content: request.message },
  ];
  const tools = request.tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: { ...tool.parameters },
    strict: true,
  }));
  return {
    async step(results, signal) {
      input.push(...results.map(toOutputItem));
      let raw: unknown;
      try {
        raw = await client.responses.create(
          {
            model,
            instructions: request.instructions,
            input,
            // A request for words alone (Sara explaining a trip) declares no tools at all.
            ...(tools.length === 0
              ? {}
              : { tools, tool_choice: 'auto' as const, parallel_tool_calls: true }),
            store: false,
            include: ['reasoning.encrypted_content'],
            reasoning: { effort: 'low' },
            max_output_tokens: MAX_OUTPUT_TOKENS,
          },
          signal === undefined ? {} : { signal },
        );
      } catch (error) {
        return failure(error);
      }
      return readAnswer(raw, input);
    },
  };
}

function toOutputItem(result: ToolResult): ResponseInputItem {
  return { type: 'function_call_output', call_id: result.callId, output: result.output };
}

/** Validates the answer; on success, its items join the input so the next step continues it. */
function readAnswer(raw: unknown, input: ResponseInputItem[]): ModelStep {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    return rejected(`The answer does not fit the Responses schema: ${issues.join('; ')}`, raw);
  }
  const response = parsed.data;
  const usage = { totalTokens: response.usage.total_tokens };
  if (response.status === 'failed') {
    return {
      ok: false,
      reason: 'unavailable',
      detail: `The response failed: ${response.error?.code ?? 'no code'}`,
      usage,
    };
  }
  if (response.status !== 'completed') {
    const why = response.incomplete_details?.reason ?? response.status;
    return { ok: false, reason: 'rejected', detail: `The response is not complete: ${why}`, usage };
  }
  const calls = readCalls(response);
  if (calls === undefined) {
    return { ok: false, reason: 'rejected', detail: 'Tool arguments are not JSON.', usage };
  }
  if (calls.length > 0) {
    input.push(...response.output.flatMap(continuation));
    return { ok: true, kind: 'calls', calls, usage };
  }
  return readText(response, usage);
}

/** The calls and the reasoning behind them go back with the results; messages do not. */
function continuation(item: OutputItem): ResponseInputItem[] {
  switch (item.type) {
    case 'message':
      return [];
    case 'function_call':
      return [
        {
          type: 'function_call',
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
          ...(item.id === undefined ? {} : { id: item.id }),
        },
      ];
    case 'reasoning':
      return [
        {
          type: 'reasoning',
          id: item.id,
          summary: item.summary,
          ...(typeof item.encrypted_content === 'string'
            ? { encrypted_content: item.encrypted_content }
            : {}),
        },
      ];
  }
}

function readCalls(response: OpenAIResponse): readonly ToolCall[] | undefined {
  const calls: ToolCall[] = [];
  for (const item of response.output) {
    if (item.type !== 'function_call') continue;
    const args = parseJson(item.arguments);
    if (args === undefined) return undefined;
    calls.push({ callId: item.call_id, name: item.name, arguments: args.value });
  }
  return calls;
}

function readText(response: OpenAIResponse, usage: StepUsage): ModelStep {
  const parts = response.output.flatMap((item) => (item.type === 'message' ? item.content : []));
  if (parts.some((part) => part.type === 'refusal')) {
    return { ok: false, reason: 'rejected', detail: 'The model refused to answer.', usage };
  }
  const text = parts
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('\n')
    .trim();
  return text === ''
    ? { ok: false, reason: 'rejected', detail: 'The answer has no text and no tool call.', usage }
    : { ok: true, kind: 'text', text, usage };
}

function parseJson(text: string): { readonly value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return undefined;
  }
}

function rejected(detail: string, raw: unknown): ModelStep {
  const usage = usageOnlySchema.safeParse(raw);
  return {
    ok: false,
    reason: 'rejected',
    detail,
    usage: usage.success ? { totalTokens: usage.data.usage.total_tokens } : null,
  };
}

/** Maps the SDK's errors to what Sara needs to know. A cancelled request is not a failure. */
function failure(error: unknown): ModelStep {
  if (error instanceof APIUserAbortError) throw error;
  if (error instanceof APIConnectionError) {
    return { ok: false, reason: 'unavailable', detail: 'OpenAI did not answer.', usage: null };
  }
  if (!(error instanceof APIError)) throw error;
  const status = typeof error.status === 'number' ? error.status : 0;
  const detail = `OpenAI answered HTTP ${String(status)}${error.code ? ` (${error.code})` : ''}.`;
  if (status === 429) return { ok: false, reason: 'rate_limited', detail, usage: null };
  if (status >= 500) return { ok: false, reason: 'unavailable', detail, usage: null };
  return { ok: false, reason: 'misconfigured', detail, usage: null };
}

/**
 * The SDK announces the machine it runs on (`x-stainless-os`, `-arch`, `-runtime-version`) and
 * itself in `User-Agent`. MovIQ sends the same generic identity as to every other service.
 */
function genericIdentity(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const name of [...headers.keys()]) {
      if (name.startsWith('x-stainless-')) headers.delete(name);
    }
    for (const [name, value] of Object.entries(GENERIC_BROWSER_HEADERS)) headers.set(name, value);
    return base(input, { ...init, headers });
  };
}
