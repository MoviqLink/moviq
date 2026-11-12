import { readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadConfig } from '../../src/config/config.js';
import { Secret } from '../../src/config/secret.js';
import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import type { ModelRequest } from '../../src/modules/assistant/model/language-model.js';
import {
  createOpenAIModel,
  DEFAULT_OPENAI_MODEL,
  openAIModelFromConfig,
} from '../../src/modules/assistant/model/openai.js';

const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/openai/', import.meta.url));
const KEY = 'test-key-not-real';

interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Record<string, unknown>;
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

let server: Server;
let origin: string;
let answers: Answer[] = [];
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      received.push({ path: request.url ?? '', headers: request.headers, body: jsonObject(raw) });
      const answer = answers.shift() ?? { status: 500, body: '{}' };
      response
        .writeHead(answer.status, { 'content-type': 'application/json', 'x-should-retry': 'false' })
        .end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port to listen on');
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  answers = [];
  received.length = 0;
});

const capture = async (name: string): Promise<Answer> => ({
  status: 200,
  body: await readFile(`${FIXTURES}${name}`, 'utf8'),
});

const jsonObject = (body: string): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(JSON.parse(body));

const request: ModelRequest = {
  instructions: 'You are Sara.',
  context: 'Destination: not known.',
  message: 'Bryant Park at 7 pm',
  tools: [
    {
      name: 'find_place',
      description: 'Looks up a place.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ],
};

const model = () => createOpenAIModel({ apiKey: new Secret(KEY), testOrigin: origin });

describe('the OpenAI adapter on the Responses API', () => {
  it('sends a stateless request with a generic identity and nothing about the person', async () => {
    answers.push(await capture('text.json'));
    const step = await model().open(request).step([]);
    expect(step).toEqual({
      ok: true,
      kind: 'text',
      text: expect.stringContaining('In a peaceful grove') as unknown,
      usage: { totalTokens: 123 },
    });
    const [sent] = received;
    expect(sent?.path).toBe('/api.openai.com/v1/responses');
    expect(sent?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent?.headers['user-agent']).toBe(GENERIC_USER_AGENT);
    expect(sent?.headers['sec-ch-ua-platform']).toBe('"Windows"');
    expect(sent?.headers['sec-ch-ua-mobile']).toBe('?0');
    expect(sent?.headers['sec-ch-ua']).toContain('"Chromium";v="156"');
    expect(
      Object.keys(sent?.headers ?? {}).filter((name) => name.startsWith('x-stainless')),
    ).toEqual([]);
    expect(sent?.body).toMatchObject({
      model: DEFAULT_OPENAI_MODEL,
      store: false,
      instructions: 'You are Sara.',
      input: [
        { role: 'developer', content: 'Destination: not known.' },
        { role: 'user', content: 'Bryant Park at 7 pm' },
      ],
      tools: [expect.objectContaining({ type: 'function', name: 'find_place', strict: true })],
    });
    for (const field of ['user', 'safety_identifier', 'metadata', 'previous_response_id']) {
      expect(sent?.body).not.toHaveProperty(field);
    }
  });

  it('reads tool calls and sends them back with their results', async () => {
    answers.push(await capture('function-call.json'), await capture('text.json'));
    const exchange = model().open(request);
    const first = await exchange.step([]);
    expect(first).toEqual({
      ok: true,
      kind: 'calls',
      calls: [
        {
          callId: 'call_unLAR8MvFNptuiZK6K6HCy5k',
          name: 'get_current_weather',
          arguments: { location: 'Boston, MA', unit: 'celsius' },
        },
      ],
      usage: { totalTokens: 314 },
    });
    await exchange.step([{ callId: 'call_unLAR8MvFNptuiZK6K6HCy5k', output: '{"ok":true}' }]);
    expect(received[1]?.body['input']).toEqual([
      { role: 'developer', content: 'Destination: not known.' },
      { role: 'user', content: 'Bryant Park at 7 pm' },
      {
        type: 'function_call',
        call_id: 'call_unLAR8MvFNptuiZK6K6HCy5k',
        name: 'get_current_weather',
        arguments: '{"location":"Boston, MA","unit":"celsius"}',
        id: 'fc_67ca09c6bedc8190a7abfec07b1a1332096610f474011cc0',
      },
      {
        type: 'function_call_output',
        call_id: 'call_unLAR8MvFNptuiZK6K6HCy5k',
        output: '{"ok":true}',
      },
    ]);
  });

  it('ignores the documented fields it does not read', async () => {
    answers.push(await capture('full-response.json'));
    const step = await model().open(request).step([]);
    expect(step).toMatchObject({ ok: true, kind: 'text', usage: { totalTokens: 380 } });
  });

  it('rejects an answer that does not fit, and still counts what it cost', async () => {
    const body = jsonObject((await capture('text.json')).body);
    answers.push({
      status: 200,
      body: JSON.stringify({ ...body, output: [{ type: 'web_search_call', id: 'ws_1' }] }),
    });
    const step = await model().open(request).step([]);
    expect(step).toMatchObject({ ok: false, reason: 'rejected', usage: { totalTokens: 123 } });
  });

  it('rejects an answer cut short and arguments that are not JSON', async () => {
    const text = jsonObject((await capture('text.json')).body);
    const call = jsonObject((await capture('function-call.json')).body);
    answers.push(
      {
        status: 200,
        body: JSON.stringify({
          ...text,
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      },
      {
        status: 200,
        body: JSON.stringify({
          ...call,
          output: [{ type: 'function_call', call_id: 'c1', name: 'find_place', arguments: '{' }],
        }),
      },
    );
    expect(await model().open(request).step([])).toMatchObject({
      ok: false,
      reason: 'rejected',
      detail: 'The response is not complete: max_output_tokens',
    });
    expect(await model().open(request).step([])).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'misconfigured'],
    [500, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, reason) => {
    answers.push({
      status,
      body: JSON.stringify({ error: { message: 'x', type: 'x', code: null, param: null } }),
    });
    expect(await model().open(request).step([])).toMatchObject({ ok: false, reason });
  });
});

describe('the model from the configuration', () => {
  it('is absent without OPENAI_API_KEY, and uses OPENAI_MODEL when set', () => {
    const without = loadConfig({});
    if (!without.ok) throw new Error('the empty configuration should load');
    expect(openAIModelFromConfig(without.config)).toBeUndefined();
    const configured = loadConfig({ OPENAI_API_KEY: KEY, OPENAI_MODEL: 'gpt-6.1-terra' });
    if (!configured.ok) throw new Error('the configuration should load');
    expect(openAIModelFromConfig(configured.config)?.model).toBe('gpt-6.1-terra');
  });
});
