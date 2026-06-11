import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../openai';
import { getNativeSearchCapability } from '../native-search';
import type { LLMRequest, LLMStreamEvent, ProviderKey, ToolSpec } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(line + '\n'));
      controller.close();
    },
  });
}

function makeFetchResponse(lines: string[], status = 200): Response {
  return new Response(sseStream(lines), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(adapter: OpenAIAdapter, fetchMock: () => Response): Promise<LLMStreamEvent[]> {
  globalThis.fetch = async () => fetchMock();
  const events: LLMStreamEvent[] = [];
  for await (const ev of adapter.chat(
    { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [] },
    new AbortController().signal
  )) {
    events.push(ev);
  }
  return events;
}

async function captureRequestBody(
  adapter: OpenAIAdapter,
  req: LLMRequest
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return makeFetchResponse([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
      'data: [DONE]',
    ]);
  };
  for await (const _ev of adapter.chat(req, new AbortController().signal)) {
    // Drain the stream so fetch runs.
  }
  if (!body) throw new Error('request body was not captured');
  return body;
}

const READ_RANGE_TOOL: ToolSpec = {
  name: 'read_range',
  description: 'Read cells',
  parameters: { type: 'object', properties: {}, required: [] },
  mutating: false,
};

function nativeReq(provider: ProviderKey, model = 'model'): LLMRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [READ_RANGE_TOOL],
    nativeSearch: getNativeSearchCapability(provider, model),
  };
}

const adapter = new OpenAIAdapter({ baseUrl: 'https://api.openai.com/v1', apiKey: 'test' });

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OpenAI adapter — text streaming', () => {
  it('emits text-delta events and a done event', async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
      'data: [DONE]',
    ];
    const events = await collect(adapter, () => makeFetchResponse(lines));

    const textDeltas = events.filter(e => e.type === 'text-delta');
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { type: 'text-delta'; delta: string }).delta).toBe('Hello');
    expect((textDeltas[1] as { type: 'text-delta'; delta: string }).delta).toBe(' world');

    const done = events.find(e => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});

describe('OpenAI adapter - native search request mutations', () => {
  it('adds only the OpenRouter server tool for the generic provider', async () => {
    const body = await captureRequestBody(
      new OpenAIAdapter({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test', provider: 'generic' }),
      nativeReq('generic', 'openai/gpt-4o-mini')
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_range' }) }),
      { type: 'openrouter:web_search' },
    ]);
    expect(body).not.toHaveProperty('enable_search');
  });

  it('adds only the Kimi builtin function for the kimi provider', async () => {
    const body = await captureRequestBody(
      new OpenAIAdapter({ baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'test', provider: 'kimi' }),
      nativeReq('kimi', 'kimi-k2.6')
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_range' }) }),
      { type: 'builtin_function', function: { name: '$web_search' } },
    ]);
  });

  it('adds Qwen enable_search body params without adding a server tool', async () => {
    const body = await captureRequestBody(
      new OpenAIAdapter({ baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiKey: 'test', provider: 'qwen' }),
      nativeReq('qwen', 'qwen3.5-plus')
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_range' }) }),
    ]);
    expect(body.enable_search).toBe(true);
    expect(body.search_options).toEqual({ forced_search: false, search_strategy: 'turbo' });
  });

  it('adds only the GLM web_search tool for the glm provider', async () => {
    const body = await captureRequestBody(
      new OpenAIAdapter({ baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'test', provider: 'glm' }),
      nativeReq('glm', 'glm-4.7')
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_range' }) }),
      {
        type: 'web_search',
        web_search: { enable: true, search_engine: 'search-prime', search_result: true },
      },
    ]);
  });

  it('does not send a native mutation to a different provider endpoint', async () => {
    const body = await captureRequestBody(
      new OpenAIAdapter({ baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'test', provider: 'glm' }),
      nativeReq('generic', 'openai/gpt-4o-mini')
    );

    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_range' }) }),
    ]);
    expect(JSON.stringify(body)).not.toContain('openrouter:web_search');
    expect(body).not.toHaveProperty('enable_search');
  });
});

describe('OpenAI adapter — usage extraction', () => {
  it('emits a usage event from the final chunk', async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 5 } } })}`,
      'data: [DONE]',
    ];
    const events = await collect(adapter, () => makeFetchResponse(lines));

    const usage = events.find(e => e.type === 'usage');
    expect(usage).toMatchObject({
      type: 'usage',
      inputTokens: 20,
      outputTokens: 8,
      cacheRead: 5,
      source: 'provider',
    });
  });
});

describe('OpenAI adapter — single tool call with fragmented arguments', () => {
  it('reassembles argument fragments and emits correct event sequence', async () => {
    const lines = [
      // start: id + name + first fragment
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_range', arguments: '{"workbook' } }] }, finish_reason: null }] })}`,
      // continuation fragment
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '_id":"wb1",' } }] }, finish_reason: null }] })}`,
      // last fragment
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"sheet":"Sheet1"}' } }] }, finish_reason: null }] })}`,
      // finish
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 20 } })}`,
      'data: [DONE]',
    ];
    const events = await collect(adapter, () => makeFetchResponse(lines));

    expect(events.find(e => e.type === 'tool-call-start')).toMatchObject({
      type: 'tool-call-start', index: 0, id: 'call_1', name: 'write_range',
    });

    const deltas = events.filter(e => e.type === 'tool-call-delta');
    expect(deltas).toHaveLength(3);

    // Verify full reassembly from the delta sequence
    const reassembled = deltas
      .map(e => (e as { type: 'tool-call-delta'; argumentsDelta: string }).argumentsDelta)
      .join('');
    expect(JSON.parse(reassembled)).toEqual({ workbook_id: 'wb1', sheet: 'Sheet1' });

    expect(events.find(e => e.type === 'tool-call-end')).toMatchObject({ type: 'tool-call-end', index: 0 });
    expect(events.find(e => e.type === 'done')).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });
});

describe('OpenAI adapter — multiple tool calls', () => {
  it('emits separate start/delta/end sequences for each tool call', async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_range', arguments: '{"sheet":"S1"}' } }, { index: 1, id: 'call_b', type: 'function', function: { name: 'list_sheets', arguments: '{}' } }] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 10 } })}`,
      'data: [DONE]',
    ];
    const events = await collect(adapter, () => makeFetchResponse(lines));

    const starts = events.filter(e => e.type === 'tool-call-start');
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ name: 'read_range', index: 0 });
    expect(starts[1]).toMatchObject({ name: 'list_sheets', index: 1 });

    const ends = events.filter(e => e.type === 'tool-call-end');
    expect(ends).toHaveLength(2);
  });
});

describe('OpenAI adapter — HTTP error handling', () => {
  it('emits AuthError on 401', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 });
    const events: LLMStreamEvent[] = [];
    for await (const ev of adapter.chat(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [] },
      new AbortController().signal
    )) {
      events.push(ev);
    }
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'AuthError' } });
  });

  it('emits RateLimitError on 429', async () => {
    globalThis.fetch = async () =>
      new Response('{}', { status: 429, headers: { 'retry-after': '30' } });
    const events: LLMStreamEvent[] = [];
    for await (const ev of adapter.chat(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [] },
      new AbortController().signal
    )) {
      events.push(ev);
    }
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'RateLimitError', retryAfter: 30 } });
  });
});
